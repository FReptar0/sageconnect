// tests/ResolveUuidByFolio.test.js - Test UUID resolution via portal CFDIs
// Usage: node tests/ResolveUuidByFolio.test.js <INVOICE_ID> <PROVIDER_ID>
//        node tests/ResolveUuidByFolio.test.js <INVOICE_ID> <PROVIDER_ID> --index=1

const { getCfdisByProvider } = require('../src/utils/GetTypesCFDI');

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const invoiceId = positional[0];
const providerId = positional[1];
const indexArg = args.find(a => a.startsWith('--index='));
const index = indexArg ? parseInt(indexArg.split('=')[1], 10) : 0;

if (!invoiceId || !providerId) {
    console.log('Usage: node tests/ResolveUuidByFolio.test.js <INVOICE_ID> <PROVIDER_ID> [--index=N]');
    console.log('Example: node tests/ResolveUuidByFolio.test.js FV-12345 67c8ce2310c2de209ccf5dbf');
    process.exit(1);
}

async function main() {
    console.log(`Buscando CFDIs para provider: ${providerId} (tenant index: ${index})\n`);

    const cfdis = await getCfdisByProvider(index, providerId);

    if (cfdis.length === 0) {
        console.log('Resultado: No se encontraron CFDIs para este provider.');
        process.exit(0);
    }

    console.log(`Se encontraron ${cfdis.length} CFDI(s) para el provider.\n`);

    // Intentar match por folio
    const idinvc = invoiceId.trim();
    const match = cfdis.find(c => {
        const folio = (c.cfdi?.folio || '').toString().trim();
        const serie = (c.cfdi?.serie || '').toString().trim();
        return folio === idinvc || (serie + folio) === idinvc;
    });

    // Mostrar todos los CFDIs disponibles
    console.log('CFDIs disponibles:');
    cfdis.forEach((c, i) => {
        const folio = (c.cfdi?.folio || '').toString().trim();
        const serie = (c.cfdi?.serie || '').toString().trim();
        const uuid = c.cfdi?.timbre?.uuid || '(sin UUID)';
        const total = c.cfdi?.total || '?';
        const marker = match && match === c ? ' <-- MATCH' : '';
        console.log(`  [${i + 1}] serie: ${serie || '(vacío)'} | folio: ${folio || '(vacío)'} | total: ${total} | uuid: ${uuid}${marker}`);
    });

    console.log('');

    if (match) {
        const uuid = match.cfdi?.timbre?.uuid;
        console.log(`MATCH encontrado para factura "${idinvc}":`);
        console.log(`  UUID:   ${uuid || '(sin timbre/uuid)'}`);
        console.log(`  Folio:  ${match.cfdi?.folio || '(vacío)'}`);
        console.log(`  Serie:  ${match.cfdi?.serie || '(vacío)'}`);
        console.log(`  Total:  ${match.cfdi?.total || '?'}`);
    } else {
        console.log(`No se encontró CFDI con folio "${idinvc}" para este provider.`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
