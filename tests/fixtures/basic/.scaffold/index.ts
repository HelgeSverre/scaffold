import { startServer } from "scaffold";
import { resolve } from "path";

startServer({
  dir: resolve(import.meta.dir, ".."),
  port: Number(process.env.PORT) || 5599,
});
