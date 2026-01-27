const axios = require('axios');
const supabase = require('./supabaseClient');

const N8N_WEBHOOK = 'https://n8n.srv1163673.hstgr.cloud/webhook/image-variant';
const MAX_RETRIES = 3;

class CriticalError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CriticalError';
    }
}

// Export the single item processor
// New Logic: The frontend controls the loop. This function processes ONE product (up to 3 prompts).
// It returns a Promise that resolves when all prompts for this item are handled.
async function processProductItem(item, prompts) {
    const tasks = [];
    if (prompts.prompt1) tasks.push(generateVariantWithRetry(item, 1, prompts.prompt1));
    if (prompts.prompt2) tasks.push(generateVariantWithRetry(item, 2, prompts.prompt2));
    if (prompts.prompt3) tasks.push(generateVariantWithRetry(item, 3, prompts.prompt3));

    // Run these 3 sequentially or parallel? 
    // User wants "1 request at a time" to avoid vertex limits.
    // If we run these parallel, it's 3 requests. 
    // To be safe, let's run them sequentially.
    for (const task of tasks) {
        await task;
    }
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

    // Update status to PROCESSING and save the intended path immediately
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
                // Return to allow next item to proceed
                return;
            }

            // SMART BACKOFF: If error, wait 60 seconds (likely quota issue)
            console.log(`Hit error. Waiting 60 seconds to cool down before retry...`);
            await new Promise(r => setTimeout(r, 60000));
        }
    }
}

async function makeApiCall(item, promptText, variantNum, uniqueName) {
    const payload = {
        image: item.image_link,
        ProductName: uniqueName, // Sending unique path as ProductName
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

module.exports = { processProductItem };
