const axios = require('axios');
const supabase = require('./supabaseClient');

const N8N_WEBHOOK = 'https://n8n.srv1163673.hstgr.cloud/webhook/image-variant';
const MAX_RETRIES = 5;

class CriticalError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CriticalError';
    }
}

// Concurrency configuration
const BATCH_CONCURRENCY = 5; // Process 5 products at once

async function processBatch(batchId, prompts) {
    console.log(`Starting processing for batch: ${batchId}`);

    // Fetch all items for this batch
    const { data: items, error } = await supabase
        .from('product_generations')
        .select('*')
        .eq('batch_id', batchId);

    if (error) {
        console.error('Error fetching batch items:', error);
        return;
    }

    console.log(`Found ${items.length} items to process.`);

    try {
        // Process items with limited concurrency
        const chunks = [];
        for (let i = 0; i < items.length; i += BATCH_CONCURRENCY) {
            chunks.push(items.slice(i, i + BATCH_CONCURRENCY));
        }

        for (const chunk of chunks) {
            console.log(`Processing chunk of ${chunk.length} items...`);
            await Promise.all(chunk.map(item => processItem(item, prompts)));
        }
    } catch (err) {
        if (err instanceof CriticalError) {
            console.error(`CRITICAL: Batch ${batchId} aborted due to repeated failures.`);
        } else {
            console.error("Unexpected error in batch processing:", err);
        }
    }

    console.log(`Batch ${batchId} processing execution finished.`);
}

async function processItem(item, prompts) {
    // Run all requested prompts in parallel for this item
    const tasks = [];
    if (prompts.prompt1) tasks.push(generateVariantWithRetry(item, 1, prompts.prompt1));
    if (prompts.prompt2) tasks.push(generateVariantWithRetry(item, 2, prompts.prompt2));
    if (prompts.prompt3) tasks.push(generateVariantWithRetry(item, 3, prompts.prompt3));

    await Promise.all(tasks);
}

async function generateVariantWithRetry(item, variantNum, promptText) {
    const statusField = `status${variantNum}`;
    const errorField = `error${variantNum}`;
    const pathField = `image${variantNum}_path`;

    // Generate a unique name/timestamp for this generation
    // Format: BatchID_ProductID_VarN_Timestamp
    // Sanitize product_id to be safe for filenames (alphanumeric + dashes/underscores)
    const safeProductId = (item.product_id || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '');
    const uniqueName = `${safeProductId}-${variantNum}`;

    // Update status to PROCESSING and save the intended path immediately (or on success? User said "save that")
    // Let's save it immediately so we have a record of what was sent.
    await supabase.from('product_generations').update({
        [statusField]: 'PROCESSING',
        [pathField]: uniqueName
    }).eq('id', item.id);

    let attempts = 0;
    while (attempts < MAX_RETRIES) {
        attempts++;
        try {
            console.log(`Attempt ${attempts}/${MAX_RETRIES} for ${item.product_id} var ${variantNum}...`);
            await makeApiCall(item, promptText, variantNum, uniqueName);

            // If we get here, it succeeded
            await supabase.from('product_generations').update({
                [statusField]: 'COMPLETED'
                // Path is already saved above
            }).eq('id', item.id);

            return; // Exit function on success

        } catch (err) {
            console.error(`Attempt ${attempts} failed: ${err.message}`);

            if (attempts >= MAX_RETRIES) {
                // Failed all retries
                await supabase.from('product_generations').update({
                    [statusField]: 'FAILED',
                    [errorField]: `Failed after ${MAX_RETRIES} attempts: ${err.message}`
                }).eq('id', item.id);

                // STOP ALL OPERATION
                throw new CriticalError(`Stopping all operations. Failed ${item.product_id} after ${MAX_RETRIES} retries.`);
            }

            // Wait before retry (exponential backoff or fixed?)
            // Let's do a meaningful delay like 2 seconds.
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function makeApiCall(item, promptText, variantNum, uniqueName) {
    const payload = {
        image: item.image_link,
        ProductName: uniqueName, // Sending unique path as ProductName as requested
        prompt: promptText,
        timestamp: uniqueName
    };

    const response = await axios.post(N8N_WEBHOOK, payload);

    if (response.data && response.data.success) {
        console.log(`Success ${item.product_id} var ${variantNum}`);
        return response.data;
    } else {
        throw new Error('API response was not success:true');
    }
}

module.exports = { processBatch };
