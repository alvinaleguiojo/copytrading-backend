import express from 'express';
import axios from 'axios';
import { accounts } from './const.js';
import cors from 'cors'

const app = express();
app.use(cors());

let signedUsers = accounts

// const symbol = "GBPUSDm";
// const operation = "Buy";
const lotsize = 0.04;

app.get("/", (req, res) => {
    res.send("welcome")
})

app.get("/connect", async (req, res)=>{

    try {
        const results = await Promise.all(
            signedUsers.map(async (account) => {
                try {
                    const response = await axios.get("https://mt5.mtapi.io/Connect", {
                        params: {
                            user : account.accNumber,
                            password : account.password,
                            host : account.host,
                            port : account.port,
                        }
                    });
                    
                    signedUsers.push({...account, auth: response.data})
                    return {
                        accNumber: account.accNumber,
                        status: "Order filled",
                        data: response.data
                    };
                } catch (error) {
                    return {
                        accNumber: account.accNumber,
                        status: "Failed to process order",
                        error: error.message
                    };
                }
            })
        );

        // Return all results for each account
        res.json(results);
    } catch (error) {
        console.error("Error processing orders:", error);
        res.status(500).json({ error: "Failed to process orders" });
    }
})

// Endpoint to process orders for multiple accounts
app.get("/open", async (req, res) => {
    const { symbol, operation } = req.query
    try {
        const results = await Promise.all(
            signedUsers.map(async (account) => {
                try {
                    const response = await axios.get("https://mt5.mtapi.io/OrderSend", {
                        params: {
                            id: account.auth,
                            symbol: symbol,
                            operation: operation,
                            volume: lotsize,
                            expirationType: "Specified",
                            placedType: "Web"
                        }
                    });

                    return {
                        accNumber: account.accNumber,
                        status: "Order filled",
                        data: response.data
                    };
                } catch (error) {
                    return {
                        accNumber: account.accNumber,
                        status: "Failed to process order",
                        error: error.message
                    };
                }
            })
        );

        // Return all results for each account
        res.json(results);
    } catch (error) {
        console.error("Error processing orders:", error);
        res.status(500).json({ error: "Failed to process orders" });
    }
});

async function getOpenOrders(params) {
    const { symbol } = params;

    try {
        // Fetch orders for each account
        const ordersPromises = signedUsers.map(async (account) => {
            try {
                const response = await axios.get(`https://mt5.mtapi.io/OpenedOrders?id=${account.auth}&sort=OpenTime&ascending=true`);

                if (response.status === 200) {
                    // Extract ticket numbers for each account and filter by symbol
                    const orders = response.data.filter(order => order.symbol === symbol).map(order => {
                        return { ticket: order.ticket, symbol: order.symbol, takeProfit: order.takeProfit, stopLoss: order.stopLoss };
                    });

                    return { auth: account.auth, accNumber: account.accNumber, orders };  // Return account number and its tickets
                } else {
                    return { auth: account.auth, accNumber: account.accNumber, orders: [] };  // Return empty tickets if error occurs
                }
            } catch (error) {
                return { auth: account.auth, accNumber: account.accNumber, orders: [] };  // Return empty tickets if there's a network or API error
            }
        });

        // Wait for all promises to resolve and return the results
        const results = await Promise.all(ordersPromises);
        return results;  // Return an array of accounts with their filtered ticket information
    } catch (error) {
        console.error('Error fetching open orders for multiple accounts:', error.message);
        return null;
    }
}


// Endpoint to close orders for multiple accounts
app.get("/close", async (req, res) => {
    const params = req.query

    try {
        const accountsTickets = await getOpenOrders(params);

        if (!accountsTickets || accountsTickets.length === 0) {
            return res.status(404).json({ message: "No open orders found to close." });
        }

        // Now, loop through each account and close its orders
        const closeResults = await Promise.all(accountsTickets.map(async (account) => {
            const closeOrderPromises = account.orders.map(async (order) => {
                try {
                    const response = await axios.get("https://mt5.mtapi.io/OrderClose", {
                        params: {
                            id: account.auth,  // Ensure correct auth is passed
                            ticket: order.ticket
                        }
                    });

                    if (response.status === 200) {
                        return { ticket: order.ticket, status: 'Closed' };
                    } else {
                        return { ticket: order.ticket, status: 'Failed to close', error: response.data };
                    }
                } catch (error) {
                    return { ticket: order.ticket, status: 'Failed to close', error: error.message };
                }
            });

            // Wait for all orders to be closed for this account
            const closeOrderStatus = await Promise.all(closeOrderPromises);
            return { accNumber: account.accNumber, closeOrderStatus };
        }));

        // Send back results
        res.json({ closeResults });
    } catch (error) {
        console.error('Error during the close process:', error.message);
        res.status(500).json({ message: "Error closing orders", error: error.message });
    }
});

app.get("/ordermodify", async (req, res)=>{
    const { stopLoss, takeProfit, symbol } = req.query;
    console.log(stopLoss, takeProfit, symbol)
    try {
        const accountsTickets = await getOpenOrders(req.query);

        if (!accountsTickets || accountsTickets.length === 0) {
            return res.status(404).json({ message: "No open orders found to close." });
        }

        // Now, loop through each account and close its orders
        const closeResults = await Promise.all(accountsTickets.map(async (account) => {
            const closeOrderPromises = account.orders.map(async (order) => {
                try {

                    const response = await axios.get(`https://mt5.mtapi.io/OrderModify?id=${account.auth}&ticket=${order.ticket}&stoploss=${stopLoss}&takeprofit=${takeProfit}&expirationType=Specified`);

                    if (response.status === 200) {
                        return { ticket: order.ticket, status: 'Closed' };
                    } else {
                        return { ticket: order.ticket, status: 'Failed to close', error: response.data };
                    }
                } catch (error) {
                    return { ticket: order.ticket, status: 'Failed to close', error: error.message };
                }
            });

            // Wait for all orders to be closed for this account
            const closeOrderStatus = await Promise.all(closeOrderPromises);
            return { accNumber: account.accNumber, closeOrderStatus };
        }));

        // Send back results
        res.json({ closeResults });
    } catch (error) {
        console.error('Error during the close process:', error.message);
        res.status(500).json({ message: "Error closing orders", error: error.message });
    }
})

app.listen(3001, () => {
    console.log(`Server listening at http://localhost:3001 🚀🚀🚀`);
});
