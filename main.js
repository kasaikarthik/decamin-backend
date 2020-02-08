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

function updateRecord(tableName, data, primaryColumn) {
    var query = `UPDATE ${tableName} SET `;
    Object.keys(data).forEach((v, i, a) => {
        query += `${v} = "${a[v]}"`;
        if (i <  a.length - 1)
            query += ", ";
    });

    query += ` WHERE ${primaryColumn} = "${data[primaryColumn]}";`;
    console.log(query);
}

function getRecord(tableName, primaryColumn, value) {
    var query = `SELECT * FROM ${tableName} WHERE ${primaryColumn} = "${value}";`;
    //return sqlConnection.query(query).values[0];
}

function generateToken(data, res) {
    var query = "INSERT INTO auth_tokens (timeGenerated) VALUES (CURRENT_TIMESTAMP);";
    sqlConnection.query(query, (error, result) => {
        data.token = result.insertId;
        res.send(data);
    });
}

function clearExpiredTokens() {
    console.log("Removing outdated tokens");
    var query = "DELETE FROM auth_tokens WHERE timeGenerated < CURRENT_TIMESTAMP - INTERVAL 0.5 hour;";
    sqlConnection.query(query);
}

setInterval(clearExpiredTokens, 10000);

function authenticate(email, pass,res) {
    var query = `SELECT * FROM user_data WHERE email="${email}" and password="${pass}";`;
    sqlConnection.query(query, (error, result) => {
        if (error) {
            console.log(error);
            res.status(500).send("Internal server error");
        }
        else {
            if (result.length > 0) {
                    generateToken(result[0], res);
                }
            else 
                res.send(false);
        }
    });
}

function insertRecord(tableName, data, cb) {
    var query = `INSERT INTO ${tableName} (`;
    Object.keys(data).forEach((v,i,a) => {
        query += `${v}`;
        if (i < a.length - 1)
            query += ", ";
    });
    query += ") VALUES (";

    Object.keys(data).forEach((v, i, a)=>{
        query += `"${data[v]}"`;
        if (i < a.length - 1 )
        query += ", ";
    });
    query += ");";

    sqlConnection.query(query, (error, result)=>{
        cb(error, result);
    });
}

function verifyToken(token, cb) {
    var query = "SELECT * FROM auth_tokens WHERE token = " + token + ";";
    sqlConnection.query(query, (error, result) => {
        if (error) {
            cb(error, null);
        }
        else {
            cb(null, result.length > 0);
        }
    });
}

app.use("/", (req,res,next) => {
    var token = req.body.token;
    if (!token) {
        req.verified = false;
        next();
    }
    else {
        verifyToken(token, (error, result) => {
            if (error) {
                console.error(error);
                res.status(500).send("Internal server error");
            }
            else {
                req.verified = result;
                delete req.body.token;
                next();
            }
        }); 
    }
});

app.post("/login", (req,res) => {
    console.log(req.body);
    try {
            (authenticate(req.body.email,req.body.password, res));
    } catch (e) {
        console.log(e);
        res.status(500).send("Internal server error!");
    }
});

app.post("/book", (req,res) => {
if (req.verified) {
        insertRecord("booking_data", req.body, (error,result)=>{
            if (error) {
                console.error(error);
                res.status(500).send("Internal server error");
            }
            else {
                res.send(true);
            }
        });

        res.send();
    }
    else {
        res.status(400).send("The session has expired, please log in again to continue");
    }
});

app.post("/verifyToken", (req,res)=>{
    verifyToken(req.body.token, (error, result) => {
        if (error) {
            console.error (error);
            res.status(500).send("Internal server error");
        }
        else {
            res.send(result);
        }
    });
});

const port = 3000;

app.listen(port, () => {
    console.log("listening at port " + port);
    // sqlConnection.query();
    createTableSafely(userSchema, "user_data");
    createTableSafely(driverSchema, "driver_data");
    createTableSafely(bookingSchema, "booking_data");
})