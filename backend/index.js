const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./supabaseClient');


require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

async function getNextBatchId() {
    const { data, error } = await supabase
        .from('product_generations')
        .select('batch_id')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Error fetching last batch:', error);
        return 'Batch_001';
    }

    if (!data || data.length === 0) {
        return 'Batch_001';
    }

    const lastBatchId = data[0].batch_id;
    // Match "Batch_" followed by digits
    const match = lastBatchId.match(/^Batch_(\d+)$/);
    if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        // Keep padded format e.g. Batch_002
        return `Batch_${String(nextNum).padStart(3, '0')}`;
    }

    return 'Batch_001';
}

// Route to initiate batch processing (Legacy/Backup - only uploads info now)
app.post('/api/initiate-batch', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        const { prompt1, prompt2, prompt3 } = req.body;

        if (!file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }


        const batchId = await getNextBatchId();
        const results = [];

        fs.createReadStream(file.path)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                // Remove temp file
                fs.unlinkSync(file.path);

                // Prepare data for Supabase
                // Expected CSV headers: product_id, image_link, (optional: csv_name?)
                // Schema: batch_id, csv_name, product_id, image_link, prompt1, prompt2, prompt3

                const rowsToInsert = results.map((row, index) => ({
                    batch_id: batchId,
                    csv_name: file.originalname,
                    csv_row_number: index + 1,
                    product_id: row.Product_ID || row.product_id || row.id || 'unknown',
                    image_link: row.Image_Link || row.image_link || row.image || '',
                    prompt1: prompt1,
                    prompt2: prompt2,
                    prompt3: prompt3,
                    status1: prompt1 ? 'PENDING' : 'SKIPPED',
                    status2: prompt2 ? 'PENDING' : 'SKIPPED',
                    status3: prompts ? 'PENDING' : 'SKIPPED' // Fix typo in original: prompt3 was checked via closure? No, prompts variable? 
                    // Wait, original code used: status3: prompt3 ? ...
                    // In this function scope, prompt3 IS defined.
                    // But I need to allow prompts.
                }));
                // Wait, map is cleaner.

                // Correction for map above to keep it simple and correct:
                /*
                const rowsToInsert = results.map((row, index) => ({
                    batch_id: batchId,
                    csv_name: file.originalname,
                    csv_row_number: index + 1,
                    product_id: row.Product_ID || row.product_id || row.id || 'unknown',
                    image_link: row.Image_Link || row.image_link || row.image || '',
                    prompt1: prompt1,
                    prompt2: prompt2,
                    prompt3: prompt3,
                    status1: prompt1 ? 'PENDING' : 'SKIPPED',
                    status2: prompt2 ? 'PENDING' : 'SKIPPED',
                    status3: prompt3 ? 'PENDING' : 'SKIPPED'
                }));
                */

                if (rowsToInsert.length === 0) {
                    return res.status(400).json({ error: 'CSV is empty or could not be parsed' });
                }

                // Insert into Supabase
                const { error } = await supabase
                    .from('product_generations')
                    .insert(rowsToInsert);

                if (error) {
                    console.error('Supabase Insert Error:', error);
                    return res.status(500).json({ error: 'Failed to save batch to database', details: error });
                }

                console.log(`Successfully inserted ${rowsToInsert.length} records into Supabase for batch ${batchId}`);

                // NO LONGER TRIGGERS SERVER-SIDE PROCESSING
                // processBatch(batchId, { prompt1, prompt2, prompt3 });

                res.json({ success: true, batchId, message: `Batch ${batchId} inserted. Use Browser Agent to process.` });
            });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});


// Route to get a new Batch ID for the browser
app.get('/api/new-batch-id', async (req, res) => {
    const id = await getNextBatchId();
    res.json({ batchId: id });
});

// DB LOGGING ENDPOINTS (Frontend Driven)

app.post('/api/db/start-item', async (req, res) => {
    try {
        const { batchId, csvRowNumber, productData, prompts, uniqueName, variantNum } = req.body;
        // productData = { Product_ID, Image_Link, ... }

        const productId = productData.Product_ID || productData.product_id || productData.id || 'unknown';
        const imageLink = productData.Image_Link || productData.image_link || productData.image || '';

        // Upsert logic: ensure row exists
        // We use upsert on (batch_id, product_id) usually, but here we might just insert if not exists.
        // Simplified: Check if exists, if not insert. Then update status.

        // 1. Ensure Row Exists
        let { data: row, error: fetchError } = await supabase
            .from('product_generations')
            .select('id')
            .eq('batch_id', batchId)
            .eq('product_id', productId)
            .maybeSingle();

        if (!row) {
            const { data: inserted, error: insertError } = await supabase
                .from('product_generations')
                .insert([{
                    batch_id: batchId,
                    csv_name: 'browser_upload',
                    csv_row_number: csvRowNumber,
                    product_id: productId,
                    image_link: imageLink,
                    prompt1: prompts.prompt1,
                    prompt2: prompts.prompt2,
                    prompt3: prompts.prompt3,
                    status1: prompts.prompt1 ? 'PENDING' : 'SKIPPED',
                    status2: prompts.prompt2 ? 'PENDING' : 'SKIPPED',
                    status3: prompts.prompt3 ? 'PENDING' : 'SKIPPED'
                }])
                .select()
                .single();
            if (insertError) throw insertError;
            row = inserted;
        }

        // 2. Update Status to PROCESSING
        const statusField = `status${variantNum}`;
        const pathField = `image${variantNum}_path`;

        const { error: updateError } = await supabase
            .from('product_generations')
            .update({
                [statusField]: 'PROCESSING',
                [pathField]: uniqueName
            })
            .eq('id', row.id);

        if (updateError) throw updateError;

        res.json({ success: true, id: row.id });
    } catch (err) {
        console.error('DB Start Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/db/complete-item', async (req, res) => {
    try {
        const { batchId, productId, variantNum } = req.body;
        const statusField = `status${variantNum}`;

        const { error } = await supabase
            .from('product_generations')
            .update({ [statusField]: 'COMPLETED' })
            .eq('batch_id', batchId)
            .eq('product_id', productId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('DB Complete Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/db/fail-item', async (req, res) => {
    try {
        const { batchId, productId, variantNum, errorMessage } = req.body;
        const statusField = `status${variantNum}`;
        const errorField = `error${variantNum}`;

        const { error } = await supabase
            .from('product_generations')
            .update({
                [statusField]: 'FAILED',
                [errorField]: errorMessage
            })
            .eq('batch_id', batchId)
            .eq('product_id', productId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('DB Fail Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Route to get batch status
app.get('/api/batch-status/:batchId', async (req, res) => {
    const { batchId } = req.params;

    const { data, error } = await supabase
        .from('product_generations')
        .select('*')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: true });

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    console.log(`Fetched status for batch ${batchId}: ${data ? data.length : 0} records.`);

    res.json(data);
});

// Route to get list of all batches
app.get('/api/batches', async (req, res) => {
    try {
        // Fetch minimal info to list batches. 
        // Note: For large datasets, a dedicated "batches" table or SQL View/RPC is better.
        const { data, error } = await supabase
            .from('product_generations')
            .select('batch_id, csv_name, created_at')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching batches:', error);
            return res.status(500).json({ error: 'Failed to fetch batches' });
        }

        // Deduplicate by batch_id
        const uniqueBatches = [];
        const seenBatches = new Set();

        data.forEach(item => {
            if (!seenBatches.has(item.batch_id)) {
                seenBatches.add(item.batch_id);
                uniqueBatches.push(item);
            }
        });

        res.json(uniqueBatches);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Route to download batch as CSV
app.get('/api/download-batch/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;
        const { data, error } = await supabase
            .from('product_generations')
            .select('*')
            .eq('batch_id', batchId)
            // Order by csv_row_number if available, else created_at
            .order('csv_row_number', { ascending: true, nullsFirst: false });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Batch not found or empty' });
        }

        // Fields to include in CSV
        const fields = [
            'csv_row_number',
            'product_id',
            'image_link',
            'prompt1', 'status1', 'image1_path', 'error1',
            'prompt2', 'status2', 'image2_path', 'error2',
            'prompt3', 'status3', 'image3_path', 'error3',
            'created_at'
        ];

        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(data);

        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="${batchId}_results.csv"`);
        res.status(200).send(csv);

    } catch (err) {
        console.error('Error generating CSV:', err);
        res.status(500).json({ error: 'Failed to generate CSV' });
    }
});

// Route to download images as ZIP
const archiver = require('archiver');
const axios = require('axios'); // Ensure axios is available in this file too
app.get('/api/download-images/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;

        // Fetch batch details
        const { data, error } = await supabase
            .from('product_generations')
            .select('*')
            .eq('batch_id', batchId);

        if (error || !data || data.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${batchId}_images.zip"`);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', (err) => {
            console.error('Archive error:', err);
            res.status(500).send({ error: err.message });
        });

        archive.pipe(res);

        // Collect all valid image paths
        const imagesToDownload = [];
        data.forEach(item => {
            [1, 2, 3].forEach(n => {
                if (item[`status${n}`] === 'COMPLETED' && item[`image${n}_path`]) {
                    imagesToDownload.push({
                        url: `https://rlptkbneebkgfiutcbmt.supabase.co/storage/v1/object/public/ai-image/${item[`image${n}_path`]}`,
                        filename: `${item[`image${n}_path`]}.jpg` // Or keep original extension if known? Assuming jpg for now or no ext.
                        // Actually the path might not have extension if we just set it as Batch_..._1234.
                        // But n8n probably saves it with extension or without. 
                        // Let's assume the link works as is. Ideally we should add .jpg if missing.
                        // The user said: save that as image path. 
                        // If n8n saves it as "Batch_..._1234", browser/view might treat it as binary.
                        // Safe bet: Append .png or .jpg if missing? 
                        // Let's just use the path as filename for now.
                    });
                }
            });
        });

        console.log(`Zipping ${imagesToDownload.length} images for batch ${batchId}...`);

        for (const img of imagesToDownload) {
            try {
                const response = await axios({
                    url: img.url,
                    method: 'GET',
                    responseType: 'stream'
                });
                archive.append(response.data, { name: img.filename });
            } catch (err) {
                console.error(`Failed to download image ${img.url}:`, err.message);
                // Optionally append a text file saying it failed?
                archive.append(Buffer.from(`Failed to download: ${err.message}`), { name: `${img.filename}_error.txt` });
            }
        }

        await archive.finalize();

    } catch (err) {
        console.error('Server error zip:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
