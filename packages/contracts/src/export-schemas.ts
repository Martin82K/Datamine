import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { contractSchemas } from "./index.js";

const schemaDirectory = fileURLToPath(new URL("../../../schemas/v1/", import.meta.url));

await mkdir(schemaDirectory, { recursive: true });

for (const [name, schema] of Object.entries(contractSchemas)) {
  const payload = {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...schema,
  };
  await writeFile(
    new URL(`../../../schemas/v1/${name}.schema.json`, import.meta.url),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}
