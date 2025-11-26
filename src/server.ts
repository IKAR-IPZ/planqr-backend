import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import {specs} from "./config/swagger"
import scheduleRoutes from "./routes/scheduleRoutes";

dotenv.config();

const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(express.json());

app.use('/',swaggerUi.serve, swaggerUi.setup(specs));

app.use('/api/schedule',scheduleRoutes)

app.listen(port, () => {

})