import type { Database } from "bun:sqlite";

export interface PropertyDef {
  name: string;
  type: string;
  nullable?: boolean;
  default?: any;
  values?: string[];
  entity?: string;
}

export interface EntityDef {
  properties: (string | PropertyDef)[];
  pivot?: boolean;
  seed?: Record<string, any>[];
}

export interface ScaffoldConfig {
  name?: string;
  entities: Record<string, EntityDef>;
}

export interface EntityMeta {
  entityName: string;
  tableName: string;
  routePath: string;
  properties: PropertyDef[];
  pivot: boolean;
  seed?: Record<string, any>[];
  relations: { property: string; targetEntity: string; targetTable: string }[];
}

export interface RouteEntry {
  method: string;
  pattern: string;
  segments: string[];
  handler: (req: Request, params: Record<string, string>) => Response | Promise<Response>;
}

export interface ScaffoldContext {
  db: Database;
  route: (method: string, path: string, handler: (req: Request) => Response | Promise<Response>) => void;
  broadcast: (page: string, message: object) => void;
  config: ScaffoldConfig;
}
