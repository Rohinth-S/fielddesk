import "dotenv/config"; import app from "./app.js"; const port=Number(process.env.PORT??4020); app.listen(port,()=>console.log(`FieldDesk API listening on :${port}`));
