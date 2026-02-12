import { parse as parseYaml } from "yaml";
import type { ScaffoldConfig, EntityDef, PropertyDef, EntityMeta } from "./types";

export function parseSchema(yamlContent: string): ScaffoldConfig {
  const raw = parseYaml(yamlContent);
  if (!raw || !raw.entities) {
    return { name: raw?.name, entities: {} };
  }

  const entities: Record<string, EntityDef> = {};

  for (const [entityName, entityRaw] of Object.entries(raw.entities)) {
    const e = entityRaw as any;
    const properties: PropertyDef[] = (e.properties || []).map(normalizeProperty);
    entities[entityName] = {
      properties,
      pivot: e.pivot || false,
      seed: e.seed,
    };
  }

  return { name: raw.name, entities };
}

function normalizeProperty(prop: string | Record<string, any>): PropertyDef {
  if (typeof prop === "string") {
    return { name: prop, type: "string" };
  }
  const p: PropertyDef = {
    name: prop.name,
    type: prop.type || "string",
  };
  if (prop.nullable !== undefined) p.nullable = prop.nullable;
  if (prop.default !== undefined) p.default = prop.default;
  if (prop.values) p.values = prop.values;
  if (prop.entity) p.entity = prop.entity;
  return p;
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

export function deriveEntityMeta(config: ScaffoldConfig): EntityMeta[] {
  const metas: EntityMeta[] = [];

  for (const [entityName, entityDef] of Object.entries(config.entities)) {
    const tableName = toSnakeCase(entityName) + "s";
    const routePath = entityName.toLowerCase() + "s";
    const properties = entityDef.properties as PropertyDef[];

    const relations: EntityMeta["relations"] = [];
    for (const prop of properties) {
      if (prop.type === "relation" && prop.entity) {
        relations.push({
          property: prop.name,
          targetEntity: prop.entity,
          targetTable: toSnakeCase(prop.entity) + "s",
        });
      }
    }

    metas.push({
      entityName,
      tableName,
      routePath,
      properties,
      pivot: entityDef.pivot || false,
      seed: entityDef.seed,
      relations,
    });
  }

  return metas;
}
