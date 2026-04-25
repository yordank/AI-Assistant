/**
 * Telegram AI Bot - Прост чат без команди
 * Node.js версия
 */

require('dotenv').config();
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
// const { intelligentScrape, scrapeImotBg, scrapeJobsBg, scrapeWebsite } = require('./scraper');
const { intelligentRSS, discoverRSS, parseRSS } = require('./rss-parser');

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_ANTHROPIC_API_KEY_HERE';

// Debug: Провери дали token-ът се зарежда
console.log('=== DEBUG INFO ===');
console.log('Token loaded from .env:', process.env.TELEGRAM_TOKEN ? 'YES' : 'NO');
console.log('Token value:', TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE' ? 'DEFAULT (NOT SET!)' : 'Set ✓');
if (TELEGRAM_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.log('Token format check:', TELEGRAM_TOKEN.includes(':') ? 'Valid format ✓' : 'Invalid format ✗');
}
console.log('==================\n');

// ==================== SMART DATA SOURCES ====================
// Автоматични data sources - САМО за данни които НЕ изискват API discovery
const DATA_SOURCES = {
    weather: {
        keywords: ['време', 'weather', 'температура', 'дъжд'],
        fetch: async (location = 'Plovdiv') => {
            try {
                const response = await axios.get(`https://wttr.in/${location}?format=j1`, { timeout: 10000 });
                const data = response.data.current_condition[0];
                return `🌤️ Време в ${location}:\nТемпература: ${data.temp_C}°C\nУсещане: ${data.FeelsLikeC}°C\n${data.weatherDesc[0].value}`;
            } catch (error) {
                console.error('Weather API error:', error.message);
                throw error;
            }
        },
        builtin: true
    },
};

// Динамични data sources (създадени от потребителя)
const customDataSources = {};

// Функция която автоматично намира и зарежда нужните данни
async function getRelevantData(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    let allData = '';
    
    // Провери вградените sources
    for (const [name, source] of Object.entries(DATA_SOURCES)) {
        const isRelevant = source.keywords.some(keyword => lowerPrompt.includes(keyword));
        
        if (isRelevant) {
            try {
                console.log(`  → Fetching ${name} data...`);
                const data = await source.fetch();
                allData += `\n${data}\n`;
            } catch (error) {
                console.log(`  ⚠️  Failed to fetch ${name}: ${error.message}`);
            }
        }
    }
    
    // Провери custom sources
    for (const [name, source] of Object.entries(customDataSources)) {
        const isRelevant = source.keywords.some(keyword => lowerPrompt.includes(keyword));
        
        if (isRelevant) {
            try {
                console.log(`  → Fetching custom ${name} data...`);
                const response = await axios.get(source.url);
                
                // Обработи отговора
                let data = response.data;
                if (source.jsonPath) {
                    // Извлечи данни от JSON path
                    const parts = source.jsonPath.split('.');
                    for (const part of parts) {
                        data = data[part];
                    }
                }
                
                allData += `\n${source.label}: ${JSON.stringify(data, null, 2)}\n`;
            } catch (error) {
                console.log(`  ⚠️  Failed to fetch ${name}: ${error.message}`);
            }
        }
    }
    
    return allData;
}

// Автоматични задачи - редактирай тук какво искаш
const PERIODIC_TASKS = [
    {
        name: 'Проверка заплати',
        intervalMinutes: 60, // На всеки час
        prompt: 'Провери jobs.bg за средната заплата в Пловдив и ако има промяна над 50 лв спрямо последната проверка, кажи ми.',
        enabled: false // Смени на true за да активираш
    },
    {
        name: 'Дневно резюме',
        intervalMinutes: 1440, // Веднъж дневно (24 часа)
        prompt: 'Направи ми кратко резюме на важните новини в България за деня.',
        enabled: false // Смени на true за да активираш
    },
    // Добави още задачи тук по същия формат
];

// Динамични задачи (създадени от потребителя)
const dynamicTasks = [];

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const bot = new Telegraf(TELEGRAM_TOKEN);
const anthropic = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
});

// Съхранение на разговори (user_id -> history)
const conversations = new Map();

// Admin chat ID
let adminChatId = null;

// ==================== AI ФУНКЦИИ ====================

async function chatWithAI(userId, message) {
    try {
        // Инициализирай история за нов потребител
        if (!conversations.has(userId)) {
            conversations.set(userId, []);
        }

        const history = conversations.get(userId);

        // Провери дали въпросът изисква live данни
        const needsLiveData = message.toLowerCase().match(/цена|price|курс|какъв е|колко е|сега|в момента|актуален|текущ|bitcoin|ethereum|doge|dogecoin|крипто|coin/);
        
        let enhancedMessage = message;
        
        if (needsLiveData) {
            console.log('🔍 Question needs live data, attempting intelligent API discovery...');
            
            // Стъпка 1: Опитай базовите вградени sources
            let liveData = await getRelevantData(message);
            
            // Стъпка 2: Ако няма данни - използвай AI API Discovery
            if (!liveData || liveData.trim().length === 0) {
                console.log('🤖 No built-in data found, using Claude API discovery...');
                
                // Питай Claude кой API да използваме
                const apiDiscoveryPrompt = `Анализирай този въпрос: "${message}"

Потребителят иска актуални данни. Намери НАЙ-ДОБРИЯ безплатен API за това.

Отговори САМО във формат:

API_FOUND
Type: [какви данни - напр. "Dogecoin цена", "курс EUR/BGN"]
API_Name: [име на API - напр. "CoinGecko", "ExchangeRate API"]
URL: [ТОЧЕН URL който да извикам - с параметри]
Keywords: [дума1, дума2, дума3]

Примери за популярни APIs:
- Крипто: CoinGecko API - https://api.coingecko.com/api/v3/simple/price?ids=dogecoin&vs_currencies=usd,eur
- Валути: ExchangeRate API - https://api.exchangerate-api.com/v4/latest/USD
- Акции: Alpha Vantage (изисква key)

ВАЖНО: URL-ът трябва да е готов за извикване ВЕДНАГА (с параметри)!`;

                try {
                    const discoveryResponse = await anthropic.messages.create({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 500,
                        messages: [{ role: 'user', content: apiDiscoveryPrompt }]
                    });

                    const discoveryResult = discoveryResponse.content[0].text;
                    
                    if (discoveryResult.includes('API_FOUND')) {
                        const apiInfo = parseAPIDiscovery(discoveryResult);
                        
                        if (apiInfo && apiInfo.url) {
                            console.log(`✨ Claude found API: ${apiInfo.api} - ${apiInfo.url}`);
                            
                            // Извикай API-то
                            try {
                                const apiResponse = await axios.get(apiInfo.url, { timeout: 10000 });
                                const apiData = JSON.stringify(apiResponse.data, null, 2);
                                
                                liveData = `\n🆕 ${apiInfo.type} (от ${apiInfo.api}):\n${apiData.substring(0, 1500)}\n`;
                                console.log('✅ API call successful, data retrieved');
                                
                                // Запази API-то за бъдещо използване
                                const sourceName = apiInfo.type.replace(/[^a-zA-Z0-9]/g, '_');
                                customDataSources[sourceName] = {
                                    keywords: apiInfo.keywords,
                                    url: apiInfo.url,
                                    label: `🔄 ${apiInfo.type}`,
                                    autoAdded: true,
                                    addedAt: new Date().toISOString()
                                };
                                console.log(`💾 Saved API for future use: ${sourceName}`);
                                
                            } catch (apiError) {
                                console.log(`⚠️ API call failed: ${apiError.message}`);
                            }
                        }
                    }
                } catch (discoveryError) {
                    console.log(`⚠️ API discovery failed: ${discoveryError.message}`);
                }
            }
            
            if (liveData && liveData.trim().length > 0) {
                // ИМА live данни - добави ги към въпроса
                console.log('✅ Live data found, adding to context');
                enhancedMessage = `${message}\n\n📊 Актуални данни (${new Date().toLocaleString('bg-BG')}):\n${liveData}\n\nОтговори на въпроса използвайки тези актуални данни. Ако данните са в JSON формат, извлечи нужната информация и представи я ясно.`;
            } else {
                // НЯМА live данни - дай инструкция на Claude да предложи решения
                console.log('⚠️ No live data available, instructing Claude to suggest solutions');
                enhancedMessage = `${message}\n\n⚠️ НЕ успях да намеря автоматично API за тази информация.

Отговори така:

"За [това което питат] можеш да:

🌐 Провериш на:
• [конкретен сайт 1]
• [конкретен сайт 2]

⏰ ИЛИ създай автоматична задача:

Напиши 'добави задача', после:

Задача: [име]
Интервал: [минути]
Действие: [какво да проверявам]

И аз ще ти проверявам автоматично!"`;
            }
        }

        // Добави съобщението (enhanced version)
        history.push({
            role: 'user',
            content: enhancedMessage
        });

        // Пази само последните 20 съобщения
        if (history.length > 20) {
            conversations.set(userId, history.slice(-20));
        }

        // Извикай Claude
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: conversations.get(userId)
        });

        const aiResponse = response.content[0].text;

        // Добави отговора в историята
        history.push({
            role: 'assistant',
            content: aiResponse
        });

        return aiResponse;

    } catch (error) {
        console.error('AI грешка:', error);
        return `❌ Грешка при AI: ${error.message}\n\nПровери дали API ключът е правилен.`;
    }
}

async function executeTask(taskPrompt) {
    try {
        console.log(`📋 Task: ${taskPrompt.substring(0, 60)}...`);

        // Стъпка 1: Провери вградените data sources
        let relevantData = await getRelevantData(taskPrompt);
        
        // Стъпка 2: Провери дали задачата иска RSS данни
        const needsRSS = taskPrompt.toLowerCase().match(/имот|апартамент|работа|обява|новини|рецепт|автомобил|продукт|магазин|нов/);
        
        if (needsRSS && !relevantData) {
            console.log('📡 Task needs RSS data, using intelligent RSS parser...');
            
            const rssResult = await intelligentRSS(taskPrompt, anthropic);
            
            if (rssResult.success) {
                relevantData += `\n\n${rssResult.data}`;
                console.log(`✅ RSS parsed from: ${rssResult.source} (${rssResult.rssUrl})`);
            } else {
                console.log(`⚠️ RSS failed: ${rssResult.error}`);
                if (rssResult.suggestion) {
                    console.log(`💡 Suggestion: ${rssResult.suggestion}`);
                }
            }
        }
        
        // Стъпка 3: Питай Claude дали му трябва API и кой
        if (!relevantData) {
            const discoveryPrompt = `Анализирай тази задача: "${taskPrompt}"

Налични данни: ${relevantData || 'няма'}

Ако задачата иска live данни които НЯМАШ (цени на акции, новини, спортни резултати, заплати, курсове и т.н.), отговори САМО във формат:

NEED_API
Type: [какви данни - напр. "акции Tesla", "курс EUR/BGN", "новини България"]  
API: [име на безплатен API - напр. "Yahoo Finance", "ExchangeRate-API"]
URL: [точен URL който да се извика]
Keywords: [дума1, дума2, дума3]

Ако имаш всичко нужно, отговори само: "READY"`;

            const discoveryResponse = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 500,
                messages: [{ role: 'user', content: discoveryPrompt }]
            });

            const discoveryResult = discoveryResponse.content[0].text;

            // Стъпка 4: Ако Claude иска API - добави го автоматично
            if (discoveryResult.includes('NEED_API')) {
                console.log('🔍 Claude needs an API, auto-discovering...');
                
                const apiInfo = parseAPIDiscovery(discoveryResult);
                
                if (apiInfo) {
                    console.log(`✨ Auto-adding: ${apiInfo.type}`);
                    
                    // Добави новия source
                    const sourceName = apiInfo.type.replace(/[^a-zA-Z0-9]/g, '_');
                    customDataSources[sourceName] = {
                        keywords: apiInfo.keywords,
                        url: apiInfo.url,
                        label: `🔄 ${apiInfo.type}`,
                        autoAdded: true,
                        addedAt: new Date().toISOString()
                    };
                    
                    // Вземи данните от новия API
                    try {
                        const response = await axios.get(apiInfo.url);
                        const newData = JSON.stringify(response.data, null, 2);
                        relevantData += `\n\n🆕 ${apiInfo.type}:\n${newData.substring(0, 1000)}...\n`;
                    } catch (error) {
                        console.log(`⚠️ API call failed: ${error.message}`);
                    }
                }
            }
        }

        // Стъпка 5: Изпълни задачата с всички налични данни
        const fullPrompt = `Дата и час: ${new Date().toLocaleString('bg-BG')}

${relevantData ? `📊 Live данни:\n${relevantData}\n` : ''}

Задача: ${taskPrompt}

Отговори кратко и директно.`;

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{ role: 'user', content: fullPrompt }]
        });

        const result = response.content[0].text;
        console.log(`✅ Task completed`);
        return result;

    } catch (error) {
        console.error('❌ Task error:', error.message);
        return `❌ Грешка: ${error.message}`;
    }
}

// Парсни API discovery отговор от Claude
function parseAPIDiscovery(text) {
    try {
        const lines = text.split('\n');
        
        const typeMatch = lines.find(l => l.includes('Type:'));
        const apiMatch = lines.find(l => l.includes('API:'));
        const urlMatch = lines.find(l => l.includes('URL:'));
        const keywordsMatch = lines.find(l => l.includes('Keywords:'));
        
        if (!typeMatch || !urlMatch || !keywordsMatch) {
            return null;
        }
        
        const type = typeMatch.split('Type:')[1]?.trim();
        const api = apiMatch?.split('API:')[1]?.trim();
        const url = urlMatch.split('URL:')[1]?.trim();
        const keywordsStr = keywordsMatch.split('Keywords:')[1]?.trim();
        
        const keywords = keywordsStr.split(',').map(k => k.trim().toLowerCase());
        
        return { type, api, url, keywords };
    } catch (error) {
        console.error('Failed to parse API discovery:', error);
        return null;
    }
}

// Помощна функция за взимане на крипто цени
async function getCryptoPrices() {
    try {
        // Използваме безплатен API - CoinGecko
        const https = require('https');
        
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.coingecko.com',
                path: '/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur&include_24hr_change=true',
                method: 'GET',
                headers: {
                    'User-Agent': 'TelegramBot/1.0'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const prices = JSON.parse(data);
                        
                        let result = '';
                        if (prices.bitcoin) {
                            const btcChange = prices.bitcoin.usd_24h_change ? prices.bitcoin.usd_24h_change.toFixed(2) : 'N/A';
                            result += `Bitcoin: $${prices.bitcoin.usd.toLocaleString()} (€${prices.bitcoin.eur.toLocaleString()}) - 24h: ${btcChange}%\n`;
                        }
                        if (prices.ethereum) {
                            const ethChange = prices.ethereum.usd_24h_change ? prices.ethereum.usd_24h_change.toFixed(2) : 'N/A';
                            result += `Ethereum: $${prices.ethereum.usd.toLocaleString()} (€${prices.ethereum.eur.toLocaleString()}) - 24h: ${ethChange}%`;
                        }
                        
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.end();
        });
    } catch (error) {
        throw new Error('Не мога да взема крипто цени');
    }
}

// ==================== TELEGRAM HANDLERS ====================

// ==================== TELEGRAM HANDLERS ====================

// Handler за всички текстови съобщения
bot.on('text', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const messageText = ctx.message.text;

        // Запази admin chat ID при първо съобщение
        if (adminChatId === null) {
            adminChatId = chatId;
            console.log(`Admin chat ID: ${adminChatId}`);

            // Приветствие при първо стартиране
            await ctx.reply(
                "👋 Здравей! Аз съм твоят AI асистент.\n\n" +
                "💬 **Просто пиши** и аз ще отговарям\n" +
                "⏰ **Автоматични задачи** - Мога да правя неща периодично\n\n" +
                "Примери:\n" +
                "• Обикновен въпрос: 'Какво е средната заплата в Пловдив?'\n" +
                "• Създай задача: 'добави задача'\n" +
                "• Виж задачи: 'покажи задачи'\n\n" +
                "Напиши 'помощ' за повече информация! 😊"
            );
        }

        // Специални команди (но изглеждат като обикновен текст)
        const lowerMessage = messageText.toLowerCase();

        if (lowerMessage.includes('изчисти история') || lowerMessage.includes('нов разговор')) {
            conversations.delete(userId);
            await ctx.reply('✅ Изчистих историята. Започваме нов разговор!');
            return;
        }

        if (lowerMessage.includes('статус') && lowerMessage.includes('бот')) {
            const allTasks = [...PERIODIC_TASKS, ...dynamicTasks];
            const activeTasks = allTasks.filter(t => t.enabled);
            const userHistory = conversations.get(userId) || [];

            let statusMsg = '🤖 **Статус на бота:**\n\n';
            statusMsg += '✅ AI работи\n';
            statusMsg += `💬 История: ${userHistory.length} съобщения\n`;
            statusMsg += `⏰ Активни задачи: ${activeTasks.length}\n`;

            if (activeTasks.length > 0) {
                statusMsg += '\n**Задачи:**\n';
                activeTasks.forEach((t, i) => {
                    const freq = t.intervalMinutes < 60 
                        ? `${t.intervalMinutes} мин` 
                        : t.intervalMinutes === 60 
                        ? '1 час' 
                        : t.intervalMinutes === 1440 
                        ? '1 ден' 
                        : `${Math.round(t.intervalMinutes / 60)} часа`;
                    statusMsg += `${i + 1}. ${t.name} (на всеки ${freq})\n`;
                });
            }

            await ctx.reply(statusMsg, { parse_mode: 'Markdown' });
            return;
        }

        // НОВА ФУНКЦИЯ: Добави задача
        if (lowerMessage.includes('добави задача') || lowerMessage.includes('нова задача')) {
            await ctx.reply(
                '📝 **Как да създам задача?**\n\n' +
                'Напиши ми в този формат:\n\n' +
                '`Задача: [име]\n' +
                'Интервал: [минути]\n' +
                'Действие: [какво да правя]`\n\n' +
                '**Примери:**\n\n' +
                '`Задача: Крипто цени\n' +
                'Интервал: 30\n' +
                'Действие: Провери цената на Bitcoin и ми кажи`\n\n' +
                '`Задача: Напомняне вода\n' +
                'Интервал: 60\n' +
                'Действие: Напомни ми да пия вода`',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Разпознай формат за създаване на задача
        if (messageText.includes('Задача:') && messageText.includes('Интервал:') && messageText.includes('Действие:')) {
            try {
                const lines = messageText.split('\n');
                const taskName = lines.find(l => l.includes('Задача:'))?.split('Задача:')[1]?.trim();
                const intervalStr = lines.find(l => l.includes('Интервал:'))?.split('Интервал:')[1]?.trim();
                const action = lines.find(l => l.includes('Действие:'))?.split('Действие:')[1]?.trim();

                if (!taskName || !intervalStr || !action) {
                    await ctx.reply('❌ Не мога да разбера формата. Провери дали си написал всички полета.');
                    return;
                }

                const intervalMinutes = parseInt(intervalStr);
                if (isNaN(intervalMinutes) || intervalMinutes < 1) {
                    await ctx.reply('❌ Интервалът трябва да е число (минути). Пример: 30');
                    return;
                }

                // Създай задачата
                const newTask = {
                    name: taskName,
                    intervalMinutes: intervalMinutes,
                    prompt: action,
                    enabled: true
                };

                dynamicTasks.push(newTask);

                const freq = intervalMinutes < 60 
                    ? `${intervalMinutes} минути` 
                    : intervalMinutes === 60 
                    ? '1 час' 
                    : intervalMinutes === 1440 
                    ? '1 ден' 
                    : `${Math.round(intervalMinutes / 60)} часа`;

                await ctx.reply(
                    `✅ **Задачата е създадена!**\n\n` +
                    `📌 Име: ${taskName}\n` +
                    `⏰ Интервал: На всеки ${freq}\n` +
                    `🎯 Действие: ${action}\n\n` +
                    `Задачата вече работи! За да я спреш, напиши: "спри задача ${taskName}"\n\n` +
                    `⏱️ Изпълнявам първата проверка сега...`,
                    { parse_mode: 'Markdown' }
                );

                // Изпълни задачата веднага при създаване
                runPeriodicTask(newTask).catch(console.error);
                
                return;

            } catch (error) {
                await ctx.reply(`❌ Грешка при създаване: ${error.message}`);
                return;
            }
        }

        // НОВА ФУНКЦИЯ: Покажи всички задачи
        if (lowerMessage.includes('покажи задачи') || lowerMessage.includes('списък задачи')) {
            const allTasks = [...PERIODIC_TASKS, ...dynamicTasks];
            
            if (allTasks.length === 0) {
                await ctx.reply('📭 Няма създадени задачи.\n\nНапиши "добави задача" за да създадеш нова.');
                return;
            }

            let msg = '📋 **Всички задачи:**\n\n';
            
            allTasks.forEach((task, i) => {
                const status = task.enabled ? '✅' : '⏸️';
                const freq = task.intervalMinutes < 60 
                    ? `${task.intervalMinutes} мин` 
                    : task.intervalMinutes === 60 
                    ? '1ч' 
                    : task.intervalMinutes === 1440 
                    ? '1д' 
                    : `${Math.round(task.intervalMinutes / 60)}ч`;
                
                msg += `${i + 1}. ${status} **${task.name}** (${freq})\n`;
                msg += `   _${task.prompt.substring(0, 60)}..._\n\n`;
            });

            msg += '\n💡 За да спреш задача: "спри задача [име]"\n';
            msg += '💡 За да стартираш задача: "стартирай задача [име]"';

            await ctx.reply(msg, { parse_mode: 'Markdown' });
            return;
        }

        // НОВА ФУНКЦИЯ: Спри задача
        if (lowerMessage.includes('спри задача')) {
            const taskName = messageText.split('спри задача')[1]?.trim();
            
            if (!taskName) {
                await ctx.reply('❌ Кажи ми коя задача да спра. Пример: "спри задача Крипто цени"');
                return;
            }

            const allTasks = [...PERIODIC_TASKS, ...dynamicTasks];
            const task = allTasks.find(t => t.name.toLowerCase() === taskName.toLowerCase());

            if (!task) {
                await ctx.reply(`❌ Не намирам задача "${taskName}".\n\nНапиши "покажи задачи" за да видиш всички.`);
                return;
            }

            task.enabled = false;
            await ctx.reply(`⏸️ Задачата "${task.name}" е спряна.\n\nЗа да я стартираш отново: "стартирай задача ${task.name}"`);
            return;
        }

        // НОВА ФУНКЦИЯ: Стартирай задача
        if (lowerMessage.includes('стартирай задача')) {
            const taskName = messageText.split('стартирай задача')[1]?.trim();
            
            if (!taskName) {
                await ctx.reply('❌ Кажи ми коя задача да стартирам. Пример: "стартирай задача Крипто цени"');
                return;
            }

            const allTasks = [...PERIODIC_TASKS, ...dynamicTasks];
            const task = allTasks.find(t => t.name.toLowerCase() === taskName.toLowerCase());

            if (!task) {
                await ctx.reply(`❌ Не намирам задача "${taskName}".\n\nНапиши "покажи задачи" за да видиш всички.`);
                return;
            }

            task.enabled = true;
            await ctx.reply(`✅ Задачата "${task.name}" е стартирана!`);
            return;
        }

        // НОВА ФУНКЦИЯ: Изтрий задача
        if (lowerMessage.includes('изтрий задача')) {
            const taskName = messageText.split('изтрий задача')[1]?.trim();
            
            if (!taskName) {
                await ctx.reply('❌ Кажи ми коя задача да изтрия. Пример: "изтрий задача Крипто цени"');
                return;
            }

            const index = dynamicTasks.findIndex(t => t.name.toLowerCase() === taskName.toLowerCase());

            if (index === -1) {
                await ctx.reply(`❌ Не намирам задача "${taskName}" сред създадените от теб.\n\n(Не мога да изтривам вградените задачи)`);
                return;
            }

            dynamicTasks.splice(index, 1);
            await ctx.reply(`🗑️ Задачата "${taskName}" е изтрита.`);
            return;
        }

        // НОВА ФУНКЦИЯ: Помощ
        if (lowerMessage === 'помощ' || lowerMessage === 'help') {
            await ctx.reply(
                '🤖 **Как работя?**\n\n' +
                '💬 **Обикновен чат:**\n' +
                'Просто ми пиши и аз отговарям\n\n' +
                '⏰ **Автоматични задачи:**\n' +
                '• `добави задача` - Създай нова задача\n' +
                '• `покажи задачи` - Виж всички задачи\n' +
                '• `спри задача [име]` - Спри задача\n' +
                '• `стартирай задача [име]` - Стартирай задача\n' +
                '• `изтрий задача [име]` - Изтрий задача\n\n' +
                '📡 **Data Sources (нови!):**\n' +
                '• `добави source` - Добави API източник\n' +
                '• `покажи sources` - Виж всички източници\n' +
                '• `изтрий source [име]` - Изтрий източник\n\n' +
                '🔧 **Други:**\n' +
                '• `изчисти история` - Нулирай разговора\n' +
                '• `статус бот` - Статус и активни задачи\n' +
                '• `помощ` - Това съобщение',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // НОВА ФУНКЦИЯ: Добави data source
        if (lowerMessage.includes('добави source') || lowerMessage.includes('добави източник')) {
            await ctx.reply(
                '📡 **Как да добавя data source?**\n\n' +
                'Напиши в този формат:\n\n' +
                '`Source: [име]\n' +
                'Keywords: [дума1, дума2, дума3]\n' +
                'URL: [api url]\n' +
                'Label: [как да се показва]`\n\n' +
                '**Пример - Курс EUR/BGN:**\n\n' +
                '`Source: Валута\n' +
                'Keywords: курс, евро, лев, валута\n' +
                'URL: https://api.exchangerate-api.com/v4/latest/EUR\n' +
                'Label: 💶 Курс EUR/BGN`\n\n' +
                '**Пример - Цена на злато:**\n\n' +
                '`Source: Злато\n' +
                'Keywords: злато, gold\n' +
                'URL: https://api.metals.live/v1/spot/gold\n' +
                'Label: 🥇 Цена на злато`\n\n' +
                '💡 Ботът ще извлича данни автоматично когато задача съдържа някоя от keywords!',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Разпознай формат за създаване на data source
        if (messageText.includes('Source:') && messageText.includes('Keywords:') && messageText.includes('URL:')) {
            try {
                const lines = messageText.split('\n');
                const sourceName = lines.find(l => l.includes('Source:'))?.split('Source:')[1]?.trim();
                const keywordsStr = lines.find(l => l.includes('Keywords:'))?.split('Keywords:')[1]?.trim();
                const url = lines.find(l => l.includes('URL:'))?.split('URL:')[1]?.trim();
                const label = lines.find(l => l.includes('Label:'))?.split('Label:')[1]?.trim();

                if (!sourceName || !keywordsStr || !url) {
                    await ctx.reply('❌ Липсват задължителни полета. Провери формата.');
                    return;
                }

                // Парсни keywords
                const keywords = keywordsStr.split(',').map(k => k.trim().toLowerCase());

                // Създай source
                customDataSources[sourceName] = {
                    keywords: keywords,
                    url: url,
                    label: label || sourceName
                };

                await ctx.reply(
                    `✅ **Data source създаден!**\n\n` +
                    `📡 Име: ${sourceName}\n` +
                    `🔑 Keywords: ${keywords.join(', ')}\n` +
                    `🌐 URL: ${url}\n\n` +
                    `Сега когато задача съдържа някоя от тези думи, ботът автоматично ще взема данни от този API!`,
                    { parse_mode: 'Markdown' }
                );
                return;

            } catch (error) {
                await ctx.reply(`❌ Грешка: ${error.message}`);
                return;
            }
        }

        // НОВА ФУНКЦИЯ: Покажи data sources
        if (lowerMessage.includes('покажи source') || lowerMessage.includes('списък source')) {
            let msg = '📡 **Data Sources:**\n\n';
            
            // Вградени
            msg += '**🔧 Вградени (винаги активни):**\n';
            Object.entries(DATA_SOURCES).forEach(([name, source]) => {
                msg += `• ${name}: ${source.keywords.slice(0, 3).join(', ')}\n`;
            });
            
            // Custom
            const customCount = Object.keys(customDataSources).length;
            if (customCount > 0) {
                msg += '\n**⚡ Твои custom sources:**\n';
                Object.entries(customDataSources).forEach(([name, source]) => {
                    msg += `• ${name}: ${source.keywords.join(', ')}\n`;
                    msg += `  URL: ${source.url.substring(0, 50)}...\n`;
                });
            } else {
                msg += '\n_Няма custom sources._\n';
            }
            
            msg += '\n💡 Напиши "добави source" за да създадеш нов!';
            
            await ctx.reply(msg, { parse_mode: 'Markdown' });
            return;
        }

        // НОВА ФУНКЦИЯ: Изтрий data source
        if (lowerMessage.includes('изтрий source')) {
            const sourceName = messageText.split('изтрий source')[1]?.trim();
            
            if (!sourceName) {
                await ctx.reply('❌ Кажи ми кой source да изтрия. Пример: "изтрий source Валута"');
                return;
            }

            if (customDataSources[sourceName]) {
                delete customDataSources[sourceName];
                await ctx.reply(`🗑️ Data source "${sourceName}" е изтрит.`);
            } else {
                await ctx.reply(`❌ Не намирам source "${sourceName}".\n\nНапиши "покажи sources" за да видиш всички.`);
            }
            return;
        }

        // Покажи "пише..."
        await ctx.sendChatAction('typing');

        // Получи отговор от AI
        const aiResponse = await chatWithAI(userId, messageText);

        // Изпрати отговора
        await ctx.reply(aiResponse);

        console.log(`User ${userId}: ${messageText.substring(0, 50)}... -> Response sent`);

    } catch (error) {
        console.error('Грешка при обработка на съобщение:', error);
        await ctx.reply(`❌ Грешка: ${error.message}`);
    }
});

// ==================== ПЕРИОДИЧНИ ЗАДАЧИ ====================

async function sendTelegramMessage(message) {
    if (adminChatId) {
        try {
            await bot.telegram.sendMessage(adminChatId, message, { parse_mode: 'Markdown' });
            console.log('Periodic task result sent');
        } catch (error) {
            console.error('Failed to send message:', error);
        }
    }
}

async function runPeriodicTask(task) {
    const timestamp = new Date().toLocaleString('bg-BG');
    console.log(`\n⏰ [${timestamp}] Running task: ${task.name}`);

    const result = await executeTask(task.prompt);
    const message = `⏰ **${task.name}**\n_${timestamp}_\n\n${result}`;

    await sendTelegramMessage(message);
    console.log(`✅ Task "${task.name}" completed and sent\n`);
}

function startTaskScheduler() {
    console.log('Task scheduler started');

    const lastRun = new Map();

    // Инициализирай last run времена за вградените задачи
    PERIODIC_TASKS.forEach(task => {
        lastRun.set(task.name, 0);
    });

    // Провери на всеки 10 секунди
    setInterval(() => {
        const now = Date.now();

        // Комбинирай вградени и динамични задачи
        const allTasks = [...PERIODIC_TASKS, ...dynamicTasks];
        const enabledTasks = allTasks.filter(t => t.enabled);

        // Debug log на всеки 60 сек
        if (Math.floor(now / 60000) % 1 === 0 && enabledTasks.length > 0) {
            const taskStatus = enabledTasks.map(t => {
                const nextRun = lastRun.get(t.name) + (t.intervalMinutes * 60 * 1000);
                const timeUntil = Math.max(0, Math.floor((nextRun - now) / 60000));
                return `${t.name} (${timeUntil}m)`;
            }).join(', ');
            console.log(`⏱️  Active tasks: ${taskStatus}`);
        }

        allTasks.forEach(task => {
            if (!task.enabled) return;

            // Инициализирай ако е нова задача
            if (!lastRun.has(task.name)) {
                lastRun.set(task.name, 0);
                console.log(`📝 New task registered: ${task.name}`);
            }

            const intervalMs = task.intervalMinutes * 60 * 1000;
            const timeSinceLastRun = now - lastRun.get(task.name);

            if (timeSinceLastRun >= intervalMs) {
                runPeriodicTask(task).catch(console.error);
                lastRun.set(task.name, now);
            }
        });
    }, 10000); // Провери на всеки 10 сек

    // Покажи активни задачи
    const activeTasks = PERIODIC_TASKS.filter(t => t.enabled);
    if (activeTasks.length > 0) {
        console.log('Active tasks:', activeTasks.map(t => t.name).join(', '));
    } else {
        console.log('No active periodic tasks (edit PERIODIC_TASKS to enable)');
    }
}

// ==================== MAIN ====================

async function main() {
    console.log('Starting Telegram AI Bot...');

    // Стартирай планировчика на задачите
    startTaskScheduler();

    console.log('Bot is running! Send a message in Telegram to start.');

    // Стартирай бота
    await bot.launch();

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// Стартирай бота
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
