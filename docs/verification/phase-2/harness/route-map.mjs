import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? walk(p) : p
  })
}

const files = walk("app/api")
  .filter((f) => f.endsWith("route.ts"))
  .sort()
const VERBS = ["GET", "POST", "PATCH", "PUT", "DELETE"]

for (const f of files) {
  const src = readFileSync(f, "utf8")
  const actions = [
    ...src.matchAll(/import \{([^}]*)\} from "@\/lib\/actions[^"]*"/gs),
  ].flatMap((m) =>
    m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
  const schemas = [
    ...src.matchAll(/import \{([^}]*)\} from "@\/lib\/schemas[^"]*"/gs),
  ].flatMap((m) =>
    m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
  const scope = [
    ...src.matchAll(/import \{([^}]*)\} from "@\/lib\/api\/scope"/gs),
  ].flatMap((m) =>
    m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )

  // Split the file into per-verb bodies: from `export ... function VERB(` to the
  // next such marker (or EOF).
  const marks = []
  for (const v of VERBS) {
    const i = src.search(new RegExp(`^export (async )?function ${v}\\(`, "m"))
    if (i >= 0) marks.push([i, v])
  }
  marks.sort((a, b) => a[0] - b[0])

  console.log(f)
  marks.forEach(([start, verb], idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1][0] : src.length
    const body = src.slice(start, end)
    const usedActions = actions.filter((a) =>
      new RegExp(`\\b${a}\\(`).test(body)
    )
    const usedSchemas = schemas.filter((s) =>
      new RegExp(`\\b${s}\\b`).test(body)
    )
    const usedScope = scope.filter((s) => new RegExp(`\\b${s}\\(`).test(body))
    const status = /status: (\d+)/.exec(body)
    console.log(
      `  ${verb.padEnd(6)} action=${usedActions.join("+") || "-"}` +
        `  schema=${usedSchemas.join("+") || "-"}` +
        (usedScope.length ? `  scope=${usedScope.join("+")}` : "") +
        (status ? `  status=${status[1]}` : "")
    )
  })
}
