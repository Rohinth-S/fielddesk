import "dotenv/config";
import app from "./app.js";
import { bootstrapPersistence, persistenceMode } from "./persistence.js";
import { setRepository } from "./app.js";
import { createRepository } from "./repository.js";

const port = Number(process.env.PORT ?? 4020);
bootstrapPersistence("fielddesk")
  .then(async (result) => {
    setRepository(await createRepository());
    app.listen(port, () =>
      console.log(
        `FieldDesk API listening on :${port} (${result.mode}/${persistenceMode()})`,
      ),
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
