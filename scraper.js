/**
 * Web Scraper Module
 * Добавя web scraping възможности към бота
 */

const axios = require('axios');
const cheerio = require('cheerio');

// ==================== ИНТЕЛИГЕНТЕН SCRAPER ====================

/**
 * УМЕН SCRAPER - Claude избира кой сайт да скрейпне
 */
async function intelligentScrape(taskDescription, anthropicClient) {
    try {
        console.log('🧠 Intelligent scraping: analyzing task...');
        
        // Стъпка 1: Питай Claude кой сайт е най-добър
        const discoveryPrompt = `Анализирай тази задача: "${taskDescription}"

Коя е НАЙ-ДОБРАТА българска website за тази информация?

Отговори САМО във формат:
WEBSITE: [точен URL на сайта]
SELECTORS:
- container: [CSS селектор за основен контейнер на резултатите]
- title: [CSS селектор за заглавие]
- price: [CSS селектор за цена (ако има)]
- link: [CSS селектор за линк]

Примери:
- За имоти → imot.bg, olx.bg, imoti.net
- За работа → jobs.bg, zaplata.bg, karierni.bg
- За автомобили → mobile.bg, cars.bg
- За новини → dir.bg, dnes.bg, news.bg
- За рецепти → gotvach.bg
- За продукти → pazaruvaj.com, emag.bg

Избери САМО 1 сайт - най-популярния и надежден!`;

        const response = await anthropicClient.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{ role: 'user', content: discoveryPrompt }]
        });

        const claudeResponse = response.content[0].text;
        
        // Стъпка 2: Парсни отговора на Claude
        const websiteMatch = claudeResponse.match(/WEBSITE:\s*(.+)/);
        const containerMatch = claudeResponse.match(/container:\s*(.+)/);
        const titleMatch = claudeResponse.match(/title:\s*(.+)/);
        const priceMatch = claudeResponse.match(/price:\s*(.+)/);
        const linkMatch = claudeResponse.match(/link:\s*(.+)/);
        
        if (!websiteMatch || !containerMatch) {
            console.log('⚠️ Claude could not determine website');
            return {
                success: false,
                error: 'Не мога да определя кой сайт да използвам'
            };
        }
        
        const targetUrl = websiteMatch[1].trim();
        const selectors = {
            container: containerMatch[1].trim(),
            title: titleMatch ? titleMatch[1].trim() : '.title',
            price: priceMatch ? priceMatch[1].trim() : '.price',
            link: linkMatch ? linkMatch[1].trim() : 'a'
        };
        
        console.log(`🎯 Claude selected: ${targetUrl}`);
        console.log(`📋 Selectors:`, selectors);
        
        // Стъпка 3: Скрейпни сайта
        const scrapeResult = await scrapeWebsite(targetUrl, selectors);
        
        if (scrapeResult.success) {
            console.log(`✅ Scraped ${scrapeResult.count} items`);
            
            // Форматирай резултата
            let formattedResult = `📊 Резултати от ${new URL(targetUrl).hostname}:\n\n`;
            
            scrapeResult.data.slice(0, 5).forEach((item, i) => {
                formattedResult += `${i + 1}. ${item.title || 'N/A'}\n`;
                if (item.price) formattedResult += `   💰 ${item.price}\n`;
                if (item.link) formattedResult += `   🔗 ${item.link}\n`;
                formattedResult += '\n';
            });
            
            return {
                success: true,
                data: formattedResult,
                source: targetUrl,
                count: scrapeResult.count
            };
        }
        
        return scrapeResult;
        
    } catch (error) {
        console.error('❌ Intelligent scrape error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== WEB SCRAPING ФУНКЦИИ ====================

/**
 * Scrape imot.bg за нови обяви в Пловдив
 */
async function scrapeImotBg() {
    try {
        const url = 'https://www.imot.bg/pcgi/imot.cgi?act=3&slink=cj8sn2&f1=1';
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const apartments = [];

        // Намери всички обяви
        $('.price').each((i, element) => {
            if (i < 5) {
                const price = $(element).text().trim();
                const link = $(element).closest('a').attr('href');
                const title = $(element).closest('.info').find('.title').text().trim();
                
                apartments.push({
                    title: title || 'Апартамент',
                    price,
                    link: link ? 'https://www.imot.bg' + link : ''
                });
            }
        });

        return {
            success: true,
            data: apartments,
            count: apartments.length
        };

    } catch (error) {
        console.error('Scraping error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Scrape jobs.bg за обяви в Пловдив
 */
async function scrapeJobsBg() {
    try {
        const url = 'https://www.jobs.bg/front_job_search.php?location_sid=2';
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const jobs = [];

        // Намери обяви
        $('.job-item').each((i, element) => {
            if (i < 5) {
                const title = $(element).find('.job-title').text().trim();
                const company = $(element).find('.company').text().trim();
                const salary = $(element).find('.salary').text().trim();
                const link = $(element).find('a').attr('href');
                
                jobs.push({
                    title,
                    company,
                    salary,
                    link
                });
            }
        });

        return {
            success: true,
            data: jobs,
            count: jobs.length
        };

    } catch (error) {
        console.error('Scraping error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Универсална scraping функция
 */
async function scrapeWebsite(url, selectors) {
    try {
        console.log(`🌐 Scraping: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml',
                'Accept-Language': 'bg,en;q=0.9'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const results = [];

        $(selectors.container).each((i, element) => {
            if (i < 10) { // Максимум 10 резултата
                const item = {
                    title: $(element).find(selectors.title).text().trim(),
                    price: selectors.price ? $(element).find(selectors.price).text().trim() : null,
                    link: $(element).find(selectors.link).attr('href')
                };
                
                // Fix relative links
                if (item.link && !item.link.startsWith('http')) {
                    const baseUrl = new URL(url);
                    item.link = baseUrl.origin + (item.link.startsWith('/') ? '' : '/') + item.link;
                }
                
                if (item.title || item.price) {
                    results.push(item);
                }
            }
        });

        return {
            success: true,
            data: results,
            count: results.length
        };

    } catch (error) {
        console.error('Scraping error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== EXPORT ====================

module.exports = {
    intelligentScrape,
    scrapeImotBg,
    scrapeJobsBg,
    scrapeWebsite
};
