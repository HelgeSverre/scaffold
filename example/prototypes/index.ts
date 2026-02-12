import { startServer } from "scaffold";

startServer({
  dir: import.meta.dir,
  port: Number(process.env.PORT) || 1234,
});
