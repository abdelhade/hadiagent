'use strict';

const http = require('http');
const { getInstalledPrinters, printContent } = require('./printer-service');
const { loadAssignments } = require('./assignment-store');

let server = null;

function startServer(port = 5000) {
    if (server) return;

    server = http.createServer(async (req, res) => {
        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Desktop-Token');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', version: '1.2.0' }));
            return;
        }

        if (req.url === '/print/direct' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const assignments = await loadAssignments();
                    const directPrinter = assignments['_direct_printer'];

                    if (!directPrinter) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'لم يتم إعداد الطابعة المباشرة' }));
                        return;
                    }

                    // Actual printing using Electron's print functionality
                    const printSuccess = await printContent(data.content || '', directPrinter);
                    
                    if (printSuccess) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'تم إرسال الطباعة بنجاح', printer: directPrinter }));
                    } else {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'فشلت عملية الطباعة في الويندوز' }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }

        if (req.url === '/print/kitchen' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    const assignments = await loadAssignments();
                    const categoryId = data.category_id;
                    const kitchenPrinter = categoryId ? assignments[String(categoryId)] : null;

                    if (!kitchenPrinter) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'لم يتم إعداد طابعة لهذا القسم' }));
                        return;
                    }

                    console.log(`[PRINT KITCHEN] Sending to printer: ${kitchenPrinter} for category: ${categoryId}`);
                    const printSuccess = await printContent(data.content || '', kitchenPrinter);

                    if (printSuccess) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'تم إرسال طباعة التحضير بنجاح', printer: kitchenPrinter }));
                    } else {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'فشلت عملية طباعة التحضير' }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Not Found' }));
    });

    server.listen(port, '127.0.0.1', () => {
        console.log(`[Local Server] Listening on http://127.0.0.1:${port}`);
    });
}

function stopServer() {
    if (server) {
        server.close();
        server = null;
    }
}

module.exports = { startServer, stopServer };
function stopServer() {
    if (server) {
        server.close();
        server = null;
    }
}

module.exports = { startServer, stopServer };
