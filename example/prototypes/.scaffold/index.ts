import { startServer } from "scaffold";
import { join } from "path";

startServer({
  dir: join(import.meta.dir, ".."),
  port: Number(process.env.PORT) || 1234,
});
