import express from 'express';
import serverless from 'serverless-http';
import session from 'express-session';
import authRouter from './router/auth';
import movieRouter from './router/movie';
import s3Router from "./router/s3"; // 👈 加这行
const app = express();
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'netlify-ts',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 300000 }
}));

app.use(authRouter);
app.use(movieRouter); 
app.use(s3Router); // 👈 加这行
export const handler = serverless(app);