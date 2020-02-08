const express = require("express");
const mysql = require("mysql");

const auth = require("./auth.json");
const userSchema = require("./userSchema.json");
const bookingSchema = require("./bookingSchema.json");
const driverSchema = require("./driverSchema.json");

const status = {
    booked: 0,
    inProgress: 1,
    complete: 2
};

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

function updateRecord(tableName, data, primaryColumn, cb) {
    var query = `UPDATE ${tableName} SET `;
    Object.keys(data).forEach((v, i, a) => {
        query += `${v} = "${data[v]}"`;
        if (i <  a.length - 1)
            query += ", ";
    });

    query += ` WHERE ${primaryColumn} = "${data[primaryColumn]}";`;
    sqlConnection.query(query, cb);
}

function getRecord(tableName, primaryColumn, value) {
    var query = `SELECT * FROM ${tableName} WHERE ${primaryColumn} = "${value}";`;
    //return sqlConnection.query(query).values[0];
}

function generateToken(data, res) {
    var query = `INSERT INTO auth_tokens (timeGenerated, email) VALUES (CURRENT_TIMESTAMP, "${data.email}");`;
    sqlConnection.query(query, (error, result) => {
        data.token = result.insertId;
        res.send(data);
    });
}

function clearExpiredTokens() {
    console.log("Removing outdated tokens");
    var query = "DELETE FROM auth_tokens WHERE timeGenerated < CURRENT_TIMESTAMP - INTERVAL 12 hour;";
    sqlConnection.query(query);
}

setInterval(clearExpiredTokens, 10000);

function authenticate(email, pass,res) {
    var query = `SELECT * FROM user_data as u,driver_data as d WHERE (u.email="${email}" and u.password="${pass}") OR (d.email="${email}" AND d.password="${pass}");`;
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

function getEmailFromToken(token, cb) {
    var query = `SELECT email FROM auth_tokens WHERE token = ${token};`;
    sqlConnection.query(query, cb);
}

app.post("/driver/getPassengers", (req,res)=>{
    var query = `SELECT * FROM booking_data WHERE status <> ${status.complete} and driverEmail=${getEmailFromToken(req.token)};`;
    sqlConnection.query(query, (error, result)=>{
        if (error) {
            console.error(error);
            res.status(500).send();
        }
        else {
            res.send(result);
        }
    });
});

app.use("/", (req,res,next) => {
    var token = req.body.token; 
    if (!token) {
        req.verified = false;
        next();
    }
    else {
        verifyToken(token, (error, result) => {
            if (error) {
                console.error("From /:");
                console.error(error);
                res.status(500).send("Internal server error");
            }
            else {
                req.verified = result;
                var query = "SELECT 1800 - CURRENT_TIMESTAMP + timeGenerated as timeLeft FROM auth_tokens WHERE token = " + req.body.token + ";";
                sqlConnection.query(query, (error, result) => {
                    if (error) {
                        console.error(error);
                        res.status(500).send("Internal error occured!");
                    }
                    else {
                        req.token = req.body.token;
                        delete req.body.token;
                        req.timeLeft = result[0];
                        next();
                    }
                });
            }
        }); 
    }
});

app.post("/getAllDrivers", (req,res)=>{
    if (req.verified) {
        var query = "SELECT * FROM driver_data WHERE isActive=true and noOfPassengers < 4;";
        sqlConnection.query(query, (error, result)=>{
            if (error) {
                console.error(error);
            }
            else {
                res.send(result);
            }
        });
    }
    else {
        res.status(400).send("The session has expired, please log in agarein to continue");
    }
});

app.post("/driver/updatePosition", (req,res)=>{
    if (req.verified) {
        var query = `UPDATE driver_data SET `;
        Object.keys(req.body).forEach((v, i, a) => {
            query += `${v} = ${req.body[i]}`;
            if (i < a.length - 1) query += ", ";
        });

        query += ` WHERE email=${req.body.email};`;
        
        sqlConnection.query(query, (error, result)=> {
            if (error) {
                console.error(error);
            }
            else {
                res.status(200).send(true);
            }
        });
    }
    else {
        res.status(400).send("The session has expired, please log in agarein to continue");
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

app.put("/book", (req,res) => {
if (req.verified) {
        insertRecord("booking_data", req.body, (error,result)=>{
            if (error) {
                console.error(error);
                res.status(500).send("Internal server error");
            }
            else {
                res.send({id: result.insertId});
            }
        });
    }
    else {
        res.status(400).send("The session has expired, please log in again to continue");
    }
});

app.post("/user", (req,res)=>{
    if (req.verified) {
        if (!req.body.email) {
            res.status(400).send("Need email");
            return;
        }
        var query = "UPDATE user_data SET due = due + " + req.body.due + ` WHERE email = "${req.body.email}";`;
        sqlConnection.query(query, (error, result)=>{
            if (error) {
                console.error("at /user");
                console.error(error);
                res.status(500).send("Internal server error");
            }
            else {
                res.send();
            }
        });
    }
    else {
        res.status(400).send("The session has expired, please log in again to continue");
    }
});

app.post("/verifyToken", (req,res)=>{
    if (req.verified) {
        res.send(req.timeLeft);
    }
    else {
        res.send(false);
    }
});

function distance(pos0, pos1) {
    return (pos0.lat-pos1.lat) * (pos0.lat-pos1.lat) + (pos1.lon-pos0.lon) * (pos1.lon-pos0.lon);
}

function findClosest(currentPosition, drivers) {
    var minDistance = distance(currentPosition, {lat: drivers[0].position_lat, lon: drivers[0].position_lon});
    var ans = drivers[0];
    drivers.forEach((v)=>{
        var temp;
        temp = distance(currentPosition, {lat: v.position_lat, lon: v.position_lon});
        
        if (temp < minDistance) {
            ans = v;
            minDistance = temp;
        }

        console.log(temp);
        console.log(minDistance);
    });

    return ans;
}
  
app.post("/getNearestDriver", (req,res)=>{
    if (req.verified) {
        var query = "SELECT * FROM driver_data;";
        sqlConnection.query(query, (error, result)=>{
            if (error) {
                console.error(error);
                res.status(500).send();
            }
            else {
                res.send(findClosest(req.body.currentPosition, result));
            }
        });
    }
    else {
        res.status(400).send("The session has expired, please log in again to continue");
    }
});

app.post("/bookingUpdate", (req,res)=>{
    if (req.verified) {
        updateRecord("booking_data", req.body, "id", (error,result)=>{
            if (error) {
                console.error(error);
                res.status(500).send();
            }
            else {
                res.send();
            }
        });
    }
    else {
        res.status(400).send();
    }
});

const port = 3000;

app.listen(port, () => {
    console.log("listening at port " + port);
    // sqlConnection.query();
    createTableSafely(userSchema, "user_data");
    createTableSafely(driverSchema, "driver_data");
    createTableSafely(bookingSchema, "booking_data");
})