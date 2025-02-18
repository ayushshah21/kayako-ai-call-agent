import { KayakoService } from '../services/kayakoService';
import { AxiosError } from 'axios';

async function exploreKayakoContent() {
    const kayako = new KayakoService();
    console.log('\n=== Exploring Kayako Knowledge Base ===\n');

    try {
        // Do a broad search first
        console.log('🔍 Performing broad search to discover available content...');
        const results = await kayako.searchArticles('');
        console.log(`\nFound ${results.length} items\n`);

        if (results.length > 0) {
            console.log('Content Overview:');
            results.forEach((item: any, index: number) => {
                console.log(`\n[Item ${index + 1}]`);
                // Log all properties to see what's available
                Object.entries(item).forEach(([key, value]) => {
                    if (typeof value === 'object' && value !== null) {
                        console.log(`   ${key}:`, JSON.stringify(value, null, 2));
                    } else {
                        console.log(`   ${key}: ${value}`);
                    }
                });
            });
        }

        // Try some basic searches to see what kind of content is searchable
        const searchTerms = ['help', 'support', 'guide', 'faq'];
        for (const term of searchTerms) {
            console.log(`\n🔍 Searching for '${term}'...`);
            const items = await kayako.searchArticles(term);
            console.log(`Found ${items.length} items matching '${term}'`);

            if (items.length > 0) {
                items.forEach((item: any) => {
                    console.log('\nItem Details:');
                    if (item.title) console.log(`   Title: ${item.title}`);
                    if (item.type) console.log(`   Type: ${item.type}`);
                    if (item.resource_type) console.log(`   Resource Type: ${item.resource_type}`);
                });
            }
        }

    } catch (error) {
        if (error instanceof Error) {
            console.error('Error during exploration:', error.message);
            if ((error as AxiosError).response?.data) {
                console.error('API Response:', (error as AxiosError).response?.data);
            }
        }
    }
}

// Run the exploration
exploreKayakoContent().then(() => {
    console.log('\n=== Exploration Complete ===\n');
}).catch(error => {
    if (error instanceof Error) {
        console.error('Script failed:', error.message);
    }
}); 