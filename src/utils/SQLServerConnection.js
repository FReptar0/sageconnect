const sql = require('mssql');
require('dotenv').config({ path: '.env.credentials.database' });

const dbConfig = {
    user: process.env.USER,
    password: process.env.PASSWORD,
    server: process.env.SERVER,
    database: process.env.DATABASE, // por defecto, usa la base de datos FESA
};

/* async function runQuery(query, database = 'FESA') {
    const pool = await new sql.ConnectionPool({
        ...dbConfig,
        database: database, // si se especifica otra base de datos, se usa esa en vez de la FESA
        options: {
            trustServerCertificate: true
        }
    }).connect();

    const result = await pool.request().query(query);

    console.log(result)


    const returnValue = {
        rowsAffected: result.rowsAffected[0],
        recordset: result.recordset == undefined ? [] : result.recordset[0],
        length: result.recordset == undefined ? 0 : result.recordset.length
    }

    pool.close();
    return returnValue;
} */
async function runQuery() {
    const pool = await new sql.ConnectionPool({
        ...dbConfig,
        database: 'CMXDAT', // si se especifica otra base de datos, se usa esa en vez de la FESA
        options: {
            trustServerCertificate: true
        }
    }).connect();

    const result = await pool.request().query(`SELECT P.CNTBTCH as LotePago, P.CNTENTR as AsientoPago, BK.ADDR1 AS bank_account_id, B.IDBANK, P.DATEBUS as FechaAsentamiento
    , P.DOCNBR as external_id,P.TEXTRMIT AS comments, P.TXTRMITREF AS reference
    , CASE BK.CURNSTMT WHEN 'MXP' THEN 'MXN' ELSE BK.CURNSTMT END AS bk_currency
    ,P.DATERMIT as payment_date, P.IDVEND as provider_external_id
    , P.AMTRMIT as total_amount
    , 'TRANSFER' as operation_type
    , P.RATEEXCHHC as TipoCambioPago
    , ISNULL((SELECT [VALUE] FROM APVENO WHERE OPTFIELD ='RFC' AND VENDORID = P.IDVEND ),'') AS RFC
    FROM APBTA B, BKACCT BK, APTCR P
    WHERE B.IDBANK = BK.BANK  AND B.PAYMTYPE = P.BTCHTYPE AND B.CNTBTCH = P.CNTBTCH 
    AND P.ERRENTRY = 0
    AND B.PAYMTYPE='PY' AND B.BATCHSTAT = 3 AND P.DATEBUS>=20230717
    AND P.DOCNBR NOT IN (SELECT NoPagoSage FROM fesa.dbo.fesaPagosFocaltec WHERE idCia = P.AUDTORG AND  NoPagoSage = P.DOCNBR )`);

    console.log(result)


    const returnValue = {
        rowsAffected: result.rowsAffected[0],
        recordset: result.recordset == undefined ? [] : result.recordset[0],
        length: result.recordset == undefined ? 0 : result.recordset.length
    }

    pool.close();
    return returnValue;
}

runQuery().catch((err)=>{
    console.log(err)
})

module.exports = {
    runQuery
};
