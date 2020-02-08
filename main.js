const express = require("express");
const mysql = require("mysql");

const auth = require("./auth.json");
const userSchema = require("./userSchema.json");
const bookingSchema = require("./bookingSchema.json");
const driverSchema = require("./driverSchema.json");

var app = new express();
app.use(express.urlencoded({extended: true}));
app.use(express.json());

const sqlConnection = mysql.createConnection(auth);

function createTableSafely(schema, tableName) {
    var query = "CREATE TABLE IF NOT EXISTS " + tableName + " (";
    Object.keys(schema).forEach((v, i, a)=>{
        query += `${v} ${schema[v]}`;
        if (i < a.length - 1)
            query += ',';
    });

    query += ");";
    sqlConnection.query(query);
}

const port = 3000;

app.listen(port, () => {
    console.log("listening at port " + port);
    // sqlConnection.query();
    createTableSafely(userSchema, "user_data");
    createTableSafely(driverSchema, "driver_data");
    createTableSafely(bookingSchema, "booking_data");
})