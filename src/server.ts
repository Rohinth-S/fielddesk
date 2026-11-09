import "dotenv/config";
import app from "./app.js";
import { bootstrapPersistence, persistenceMode } from "./persistence.js";

const port = Number(process.env.PORT ?? 4020);
bootstrapPersistence("fielddesk")
  .then((result) => {
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
