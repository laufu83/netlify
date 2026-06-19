import { Router, Request, Response } from "express";
import { pool } from "../db";
import { getSafeTable, strCut } from "../utils";
import { successResponse, errorResponse } from "../middleware";
import { pinyin } from "pinyin-pro";
const router = Router();
// 拼音配置
const MAX_LENGTH = 50;
/**
 * 根据片名生成大写拼音首字母，仅保留A-Z，无缓存
 */
function getFirstLetter(str: string): string {
  const trimStr = str?.trim();
  if (!trimStr) return '';

  try {
    // type:string 固定返回字符串，无需判断数组
    const lettersRaw = pinyin(trimStr, {
      pattern: 'first',
      type: 'string',
      toneType: 'none'
    }).toUpperCase();

  // 正则修改：保留大写字母 A-Z + 数字 0-9
    let letters = lettersRaw.replace(/[^A-Z0-9]/g, '');

    if (!letters) {
      const firstChar = trimStr[0].toUpperCase();
      letters = /[A-Z0-9]/.test(firstChar) ? firstChar : '';
    }

    // 长度截断
    if (letters.length > MAX_LENGTH) {
      letters = letters.substring(0, MAX_LENGTH);
    }

    return letters;
  } catch {
    return '';
  }
}
// ==========================
// 视频列表 ✅ 完整修复
// ==========================
router.get("/api/vod/list", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(50, Math.max(1, parseInt(req.query.size as string) || 20));
    const offset = (page - 1) * size;
    const type = req.query.type as string;
    const year = req.query.year as string;
    const area = req.query.area as string;
    const lang = req.query.lang as string;
    const clazz = req.query.class as string;
    const letter = req.query.letter as string;
    const table = getSafeTable((req.query.table as string) || "vod_dytt");

    let where = "WHERE 1=1";
    const params: any[] = [];

    if (type) {
      where += " AND type_id = ?";
      params.push(type);
    }
    if (year) {
      where += " AND vod_year = ?";
      params.push(year);
    }
    if (area) {
      where += " AND vod_area = ?";
      params.push(area);
    }
    if (lang) {
      where += " AND vod_lang = ?";
      params.push(lang);
    }
    if (clazz) {
      where += " AND vod_class like ?";
      params.push(`%${clazz}%`);
    }
    if (letter) {
      where += " AND vod_letter = ?";
      params.push(letter);
    }

    const [rows] = await pool.query(
      `SELECT * FROM ${table} ${where} ORDER BY vod_time DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );

    const [totalRow] = await pool.query(
      `SELECT COUNT(*) AS count FROM ${table} ${where}`,
      params
    );

    //const total = (totalRow as any[])[0]?.count || 0;

    res.json(successResponse(
       rows
    ));

  } catch (e) {
    res.status(500).json(errorResponse("server_error", 500, (e as Error).message));
  }
});

// ==========================
// 视频详情 ✅ 修复
// ==========================
router.get("/api/vod/detail", async (req: Request, res: Response) => {
  try {
    const id = req.query.id as string;
    const table = getSafeTable((req.query.table as string) || "vod_dytt");

    if (!id) {
      return res.status(400).json(errorResponse("invalid_param", 400, "id 不能为空"));
    }

    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE vod_id = ?`, [id]);

    if (!(rows as any[]).length) {
      return res.status(404).json(errorResponse("not_found", 404, "视频不存在"));
    }

    res.json(successResponse((rows as any[])[0]));

  } catch (e) {
    res.status(500).json(errorResponse("server_error", 500, (e as Error).message));
  }
});

// ==========================
// 搜索 ✅ 修复：补充分页总数
// ==========================
router.get("/api/vod/search", async (req: Request, res: Response) => {
  try {
    const keyword = (req.query.keyword as string) || "";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(50, Math.max(1, parseInt(req.query.size as string) || 20));
    const offset = (page - 1) * size;
    const table = getSafeTable((req.query.table as string) || "vod_dytt");
    // 正则：仅大小写字母、数字
    const ENGLISH_NUM_REG = /^[A-Za-z0-9]+$/;
    // 场景1：纯英文/数字 → 拼音首字母前缀查询（走索引）
    if (ENGLISH_NUM_REG.test(keyword)) {
      const letterKw = `${keyword.toUpperCase()}%`;
      const sql = `
        SELECT vod_id,type_name,vod_name,vod_sub,vod_class,vod_pic,vod_actor,vod_director,
               vod_time,vod_area,vod_lang,vod_year,vod_douban_score,vod_remarks,
               vod_score,vod_content,vod_play_url
        FROM ${table}
        WHERE vod_name_letter LIKE ?
        ORDER BY vod_time DESC
        LIMIT ? OFFSET ?
      `;
      const [rows] = await pool.query(sql, [letterKw, size, offset]);
        res.json(successResponse(rows));
    }else{
      const kw = `%${keyword}%`; 
      const sql = `
        SELECT t1.vod_id,t1.type_name,t1.vod_name,t1.vod_sub,t1.vod_class,t1.vod_pic,
               t1.vod_actor,t1.vod_director,t1.vod_time,t1.vod_area,t1.vod_lang,t1.vod_year,
               t1.vod_douban_score,t1.vod_remarks,t1.vod_score,t1.vod_content,t1.vod_play_url
        FROM ${table} t1
        INNER JOIN (
            SELECT DISTINCT vod_id, vod_time
            FROM (          
                SELECT vod_id, vod_time FROM ${table} WHERE vod_name LIKE ?
                UNION ALL
                SELECT vod_id, vod_time FROM ${table} WHERE vod_sub LIKE ?
                UNION ALL
                SELECT vod_id, vod_time FROM ${table} WHERE vod_actor LIKE ?
                UNION ALL
                SELECT vod_id, vod_time FROM ${table} WHERE vod_director LIKE ?
            ) AS union_result
            ORDER BY vod_time DESC
            LIMIT ? OFFSET ?
        ) t2 ON t1.vod_id = t2.vod_id
        ORDER BY t1.vod_time DESC;
      `;
      const [rows] = await pool.query(sql, [kw, kw, kw, kw, size, offset]);
      res.json(successResponse(rows));
    }
  } catch (e) {
    res.status(500).json(errorResponse("server_error", 500, (e as Error).message));
  }
});

// ==========================
// 采集同步 ✅ 修复：安全、异常、格式
// ==========================
// ==========================
// 采集同步：自动根据vod_name生成拼音首字母存入vod_name_letter
// ==========================
router.get("/api/vod/sync", async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    const table = getSafeTable((req.query.table as string) || "vod_dytt");
    const apiUrl = (req.query.api_url as string) || process.env.API_VOD_URL;

    if (!process.env.SYNC_TOKEN || token !== process.env.SYNC_TOKEN) {
      return res.status(403).json(errorResponse("forbidden", 403, "无权限"));
    }

    if (!apiUrl) {
      return res.status(400).json(errorResponse("invalid_config", 400, "未配置采集地址"));
    }

    const first = await fetch(`${apiUrl}&pg=1`);
    if (!first.ok) {
      return res.status(500).json(errorResponse("external_error", 500, "采集接口访问失败"));
    }

    const data = await first.json();
    const list = data.list || [];

    if (list.length === 0) {
      return res.json(successResponse({ msg: "暂无数据可同步", count: 0 }));
    }

    const batch = list.map((item: any) => [      
      item.vod_id,
      item.type_id,
      strCut(item.type_name, 50),
      item.type_id_1,
      strCut(item.vod_name, 255),
      strCut(item.vod_sub, 255),
      strCut(item.vod_en, 255),
      strCut(item.vod_letter, 10),
      strCut(item.vod_class, 100),
      item.vod_pic,
      strCut(item.vod_actor, 500),
      strCut(item.vod_director, 200),
      strCut(item.vod_area, 50),
      strCut(item.vod_lang, 50),
      item.vod_year,
      item.vod_douban_id,
      item.vod_douban_score,
      strCut(item.vod_content, 2000),
      strCut(item.vod_remarks, 255),
      item.vod_score,
      item.vod_play_url,
      item.vod_status,
      item.vod_time,
      getFirstLetter(item.vod_name)
    ]);

    const ph = Array(batch.length).fill("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");

    await pool.query(
      `
      INSERT INTO ${table} (
        vod_id,type_id,type_name,type_id_1,vod_name,vod_sub,vod_en,vod_letter,
        vod_class,vod_pic,vod_actor,vod_director,vod_area,vod_lang,vod_year,
        vod_douban_id,vod_douban_score,vod_content,vod_remarks,vod_score,
        vod_play_url,vod_status,vod_time,vod_name_letter
      ) VALUES ${ph}
      ON DUPLICATE KEY UPDATE 
        type_id=VALUES(type_id),
        type_name=VALUES(type_name),
        vod_name=VALUES(vod_name),
        vod_pic=VALUES(vod_pic),
        vod_play_url=VALUES(vod_play_url),
        vod_time=VALUES(vod_time),
        vod_name_letter=VALUES(vod_name_letter)
    `,
      batch.flat()
    );

    res.json(successResponse({
      msg: "同步完成",
      count: list.length,
    }));

  } catch (e) {
    res.status(500).json(errorResponse("sync_error", 500, (e as Error).message));
  }
});
/**
 * 批量补全 vod_name_letter 拼音首字母
 * 单次最多处理 2000 条，每批 200 条
 */
/**
 * 批量补全 vod_name_letter 拼音首字母
 * 每批200条，单次接口最多处理2000条，批量SQL更新
 */
router.get("/api/vod/refresh", async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    const table = getSafeTable((req.query.table as string) || "vod_dytt");

    // 权限校验
    if (!process.env.SYNC_TOKEN || token !== process.env.SYNC_TOKEN) {
       console.log(`[批量补全] 权限校验失败，非法token请求`);
      return res.status(403).json(errorResponse("forbidden", 403, "无操作权限"));
    }
    const BATCH_SIZE = 200;
    const MAX_HANDLE_TOTAL = 2000;
    let totalUpdateCount = 0;
    let offset = 0;
     let batchNo = 1;
    console.log(`\n===== 开始批量补全表【${table}】vod_name_letter =====`);
    console.log(`配置：每批${BATCH_SIZE}条，本次最大处理上限${MAX_HANDLE_TOTAL}条`);
    while (totalUpdateCount < MAX_HANDLE_TOTAL) {
      const startTime = Date.now();
      console.log(`\n【第${batchNo}批】偏移量 offset = ${offset}`);
      // 拉取当前批次需要补全首字母的数据
      const [rows] = await pool.query(
        `SELECT vod_id, vod_name FROM ${table} WHERE (vod_name_letter IS NULL) LIMIT ? OFFSET ?`,
        [BATCH_SIZE, offset]
      );
      const list = rows as Array<{ vod_id: number; vod_name: string }>;

      const fetchCount = list.length;

      if (fetchCount === 0) {
        console.log(`第${batchNo}批未查询到待更新数据，任务提前结束`);
        break;
      }

      // 批量生成首字母
      const updateData: Array<{ id: number; letter: string }> = list.map(item => {
        return {
          id: item.vod_id,
          letter: getFirstLetter(item.vod_name)
        };
      });

      // 构造批量CASE WHEN更新SQL
      const caseStr = updateData.map(item => `WHEN ${item.id} THEN ?`).join(" ");
      const idArr = updateData.map(item => item.id).join(",");
      const params = updateData.map(item => item.letter);

      const updateSql = `
        UPDATE ${table}
        SET vod_name_letter = CASE vod_id ${caseStr} END
        WHERE vod_id IN (${idArr})
      `;
      await pool.query(updateSql, params);
      const costMs = Date.now() - startTime;
      totalUpdateCount += list.length;
      batchNo++;
      offset += BATCH_SIZE;
      console.log(`✅ 第${batchNo}批执行成功，更新${fetchCount}条，耗时：${costMs}ms`);
      // 每批轻微休眠，缓解数据库压力
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return res.json(successResponse({
      batchSize: BATCH_SIZE,
      maxOnceLimit: MAX_HANDLE_TOTAL,
      actualUpdated: totalUpdateCount,
      msg: totalUpdateCount > 0 ? `成功更新${totalUpdateCount}条视频拼音首字母` : "暂无需要补全的数据"
    }));

  } catch (err) {
    return res.status(500).json(errorResponse("batch_update_error", 500, (err as Error).message));
  }
});

export default router;