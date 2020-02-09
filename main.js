const express = require("express");
const mysql = require("mysql");
const util = require("util");

const auth = require("./auth.json");
const userSchema = require("./userSchema.json");
const bookingSchema = require("./bookingSchema.json");
const driverSchema = require("./driverSchema.json");

const status = {
    unavailable: 0,
    booked: 1,
    inProgress: 2,
    completed: 3,
    cancelled: 4
};

const sqlConnection = mysql.createConnection(auth);
const sqlQuery = util.promisify(sqlConnection.query).bind(sqlConnection);
 
var app = new express();
app.use(express.urlencoded({extended: true}));
app.use(express.json());

app.use( async (req,res,next) => {
    console.log(req.body);
    var token = req.body.token; 
    if (token == undefined) {
        req.verified = false;
    }
    else {
        req.token = token;
        delete req.body.token;

        try {
            let result = await sqlQuery("SELECT * FROM auth_tokens where token = " + token + ";");
            //console.log(result);
            if (result.length > 0) {
                req.verified = true;
                let query = "SELECT 12*60*60 - CURRENT_TIMESTAMP + timeGenerated as timeLeft,email FROM auth_tokens WHERE token = " + req.token + ";";
                result = await sqlQuery(query);
                req.timeLeft = result[0].timeLeft;
                req.email = result[0].email;
            }
        }
        catch (e) {
            console.error(e);
            res.status(500).send("Internal server error");
        } 
    }
    next();
});

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
    var query = "DELETE FROM auth_tokens WHERE timeGenerated < CURRENT_TIMESTAMP - INTERVAL 12 hour;";
    sqlConnection.query(query);
}

setInterval(clearExpiredTokens, 10000);

async function authenticate(email, pass,res) {
    try {
        var result = await sqlQuery(`SELECT email FROM user_data WHERE email = "${email}" AND password = "${pass}";`);
        if (result.length > 0) {
            generateToken(result[0], res);
            return;
        }
        var result = await sqlQuery(`SELECT email FROM driver_data WHERE email = "${email}" AND password = "${pass}";`);
        if (result.length > 0) {
            generateToken(result[0], res);
            return;
        }
    }
    catch (e) {
        console.error(e);
        res.status(500).send();
    }
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

function getEmailFromToken(token, cb) {
    var query = `SELECT email FROM auth_tokens WHERE token = ${token};`;
    sqlConnection.query(query, cb);
}

app.post("/driver/getPassengers", (req,res)=>{
    var query = `SELECT * FROM booking_data WHERE driverEmail="${req.email}";`;
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
            query += `${v} = "${req.body[v]}"`;
            if (i < a.length - 1) query += ", ";
        });

        query += ` WHERE email="${req.email}";`;
        
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

app.post("/login", async (req,res) => {
    try {
        await authenticate(req.body.email,req.body.password, res);
    } catch (e) {
        console.error(e);
        res.status(500).send("Internal server error!");
    }
});

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

app.post("/book", async (req,res) => {
    if (req.verified) {
        req.body.status = status.unavailable;

        let query = `SELECT * FROM driver_data WHERE isActive = true and noOfPassengers < ${5 - req.body.noOfSeats};`;
        let drivers = await sqlQuery(query);
        let from = [req.body.from_lat,req.body.from_lon];
        let to = [req.body.to_lat, req.body.to_lon];

        let minDistance = -1;
        let driverEmail = null;

        await asyncForEach(drivers, async (v,i,a) => {
            let routePoints = [from];
            let destinations = await sqlQuery(`SELECT to_lat, to_lon from booking_data where driverEmail = "${v.email}" and status = ${status.inProgress};`);
            let distance = 0;
            while (destinations.length > 0) {
                let min = -1;
                let index = 0;
                destinations.forEach((v, i)=>{
                    let d = abs(v.to_lat - routePoints[routePoints.length-1][0]) + abs(v.to_lon - routePoints[routePoints.length-1][1]);
                    if (d < min || min == -1) {
                        min = d;
                        index = i;
                    }
                });
                routePoints.push(destinations[index]);
                destinations.splice(index, 1);
            }

            
            distance += Math.abs(to[0] - routePoints[routePoints.length-1][0]) + Math.abs(to[1] - routePoints[routePoints.length-1][1]);

            if (distance < minDistance || minDistance < 0) {
                minDistance = distance;
                driverEmail = v.email;
            }
        });

        if (minDistance > 0) {
            req.body.driverEmail = driverEmail;
            req.body.status = status.booked;
        }

        req.body.userEmail = req.body.email;
        delete req.body.email;

        insertRecord("booking_data", req.body, (error, result) => {
            if (error) {
                console.error(error);
                res.status(500).send();
            }
            else {
                res.send(req.body);
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
        res.send({timeLeft: req.timeLeft});
    }
    else {
        res.status(400).send({timeLeft: 0});
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