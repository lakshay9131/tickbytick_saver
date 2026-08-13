const axios = require("axios");

const {
    loadTokens
} = require("../dynamic_data/tokensave");

const JWT_TOKEN =
    loadTokens()?.access_token ||
    process.env.JWT_TOKEN;
async function getOptionChain(
    symbol,
    expiry,
    type = "PUT"
) {

    try {

        const response = await axios.get(
            "https://developer.paytmmoney.com/fno/v1/option-chain",
            {
                params: {
                    type,
                    symbol,
                    expiry
                },
                headers: {
                    "x-jwt-token": JWT_TOKEN
                }
            }
        );

        return response.data.data;

    } catch (err) {

        console.log("Option Chain Service Error:",
            err.response?.data || err.message
        );

        return null;
    }
}

module.exports = {
    getOptionChain
};