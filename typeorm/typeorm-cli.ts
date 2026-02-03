import "reflect-metadata";
import "dotenv/config";
import { DataSource } from "typeorm";
import { getTypeOrmConfigSync } from "../src/database/typeorm.config";

const dataSource = new DataSource(getTypeOrmConfigSync());

export default dataSource;
module.exports = dataSource;
