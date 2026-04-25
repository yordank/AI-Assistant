/**
 * RSS Parser Module
 * Автоматично намира и парсва RSS feeds
 */

const axios = require('axios');
const cheerio = require('cheerio');

// ==================== АВТОМАТИЧНО НАМИРАНЕ НА RSS ====================

/**
 * Умно намиране на RSS feed от уебсайт
 */
async function discoverRSS(websiteUrl) {
    try {
        console.log(`🔍 Discovering RSS for: ${websiteUrl}`);
        
        // Стъпка 1: Опитай стандартни RSS URLs
        const commonRSSPaths = [
            '/rss',
            '/rss.xml',
            '/feed',
            '/feed.xml',
            '/atom.xml',
            '/index.xml',
            '/?feed=rss2',
            '/rss/index.xml'
        ];
        
        const baseUrl = new URL(websiteUrl).origin;
        
        for (const path of commonRSSPaths) {
            try {
                const rssUrl = baseUrl + path;
                const response = await axios.get(rssUrl, { 
                    timeout: 5000,
                    validateStatus: (status) => status === 200
                });
                
                // Провери дали отговорът е XML/RSS
                if (response.headers['content-type']?.includes('xml') || 
                    response.data.includes('<rss') || 
                    response.data.includes('<feed')) {
                    console.log(`✅ Found RSS: ${rssUrl}`);
                    return rssUrl;
                }
            } catch (err) {
                // Продължи към следващия path
                continue;
            }
        }
        
        // Стъпка 2: Парсни HTML и търси RSS линкове
        try {
            const htmlResponse = await axios.get(websiteUrl, { timeout: 5000 });
            const $ = cheerio.load(htmlResponse.data);
            
            // Търси RSS link в <head>
            const rssLink = $('link[type="application/rss+xml"]').attr('href') ||
                          $('link[type="application/atom+xml"]').attr('href') ||
                          $('a[href*="rss"]').attr('href') ||
                          $('a[href*="feed"]').attr('href');
            
            if (rssLink) {
                const fullRssUrl = rssLink.startsWith('http') ? rssLink : baseUrl + rssLink;
                console.log(`✅ Found RSS in HTML: ${fullRssUrl}`);
                return fullRssUrl;
            }
        } catch (err) {
            console.log('⚠️ Could not parse HTML for RSS links');
        }
        
        return null;
        
    } catch (error) {
        console.error(`❌ RSS discovery failed: ${error.message}`);
        return null;
    }
}

/**
 * Парсни RSS feed
 */
async function parseRSS(rssUrl) {
    try {
        console.log(`📡 Fetching RSS: ${rssUrl}`);
        
        const response = await axios.get(rssUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data, { xmlMode: true });
        const items = [];

        // RSS 2.0 формат
        $('item').each((i, element) => {
            if (i < 10) {
                const title = $(element).find('title').text().trim();
                const link = $(element).find('link').text().trim();
                const description = $(element).find('description').text().trim()
                    .replace(/<[^>]*>/g, '') // Премахни HTML тагове
                    .substring(0, 200);
                const pubDate = $(element).find('pubDate').text().trim();
                
                if (title && link) {
                    items.push({ title, link, description, date: pubDate });
                }
            }
        });
        
        // Atom формат (ако няма RSS items)
        if (items.length === 0) {
            $('entry').each((i, element) => {
                if (i < 10) {
                    const title = $(element).find('title').text().trim();
                    const link = $(element).find('link').attr('href');
                    const description = $(element).find('summary, content').text().trim()
                        .replace(/<[^>]*>/g, '')
                        .substring(0, 200);
                    const pubDate = $(element).find('published, updated').text().trim();
                    
                    if (title && link) {
                        items.push({ title, link, description, date: pubDate });
                    }
                }
            });
        }

        return {
            success: true,
            data: items,
            count: items.length
        };

    } catch (error) {
        console.error(`❌ RSS parse error: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * ИНТЕЛИГЕНТЕН RSS SCRAPER
 * Claude избира сайта и намира RSS автоматично
 */
async function intelligentRSS(taskDescription, anthropicClient) {
    try {
        console.log('🧠 Intelligent RSS: analyzing task...');
        
        // Стъпка 1: Питай Claude кой сайт да използваме
        const discoveryPrompt = `Анализирай тази задача: "${taskDescription}"

Коя е НАЙ-ДОБРАТА българска уебсайт за тази информация?

Отговори САМО във формат:
WEBSITE: [точен URL на главната страница, напр. https://www.imot.bg или https://www.dir.bg]

Примери:
- За имоти → https://www.imot.bg
- За работа → https://www.jobs.bg
- За новини → https://www.dir.bg, https://www.dnes.bg
- За автомобили → https://www.mobile.bg
- За рецепти → https://www.gotvach.bg
- За технологии → https://www.pcworld.bg

Избери САМО 1 сайт - най-популярния!`;

        const response = await anthropicClient.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            messages: [{ role: 'user', content: discoveryPrompt }]
        });

        const claudeResponse = response.content[0].text;
        const websiteMatch = claudeResponse.match(/WEBSITE:\s*(.+)/);
        
        if (!websiteMatch) {
            return {
                success: false,
                error: 'Не мога да определя кой сайт да използвам'
            };
        }
        
        const websiteUrl = websiteMatch[1].trim();
        console.log(`🎯 Claude selected: ${websiteUrl}`);
        
        // Стъпка 2: Намери RSS feed автоматично
        const rssUrl = await discoverRSS(websiteUrl);
        
        if (!rssUrl) {
            return {
                success: false,
                error: `Не намирам RSS feed за ${websiteUrl}`,
                suggestion: `Опитай да посетиш ${websiteUrl} директно`
            };
        }
        
        // Стъпка 3: Парсни RSS feed
        const rssResult = await parseRSS(rssUrl);
        
        if (!rssResult.success) {
            return rssResult;
        }
        
        // Форматирай резултата
        let formattedResult = `📰 Резултати от ${new URL(websiteUrl).hostname}:\n\n`;
        
        rssResult.data.slice(0, 5).forEach((item, i) => {
            formattedResult += `${i + 1}. ${item.title}\n`;
            if (item.description) formattedResult += `   ${item.description}...\n`;
            if (item.link) formattedResult += `   🔗 ${item.link}\n`;
            formattedResult += '\n';
        });
        
        return {
            success: true,
            data: formattedResult,
            source: websiteUrl,
            rssUrl: rssUrl,
            count: rssResult.count
        };
        
    } catch (error) {
        console.error('❌ Intelligent RSS error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== EXPORT ====================

module.exports = {
    intelligentRSS,
    discoverRSS,
    parseRSS
};
