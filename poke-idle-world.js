// ==UserScript==
// @name         Poke Helper
// @namespace    http://tampermonkey.net/
// @version      3.4.4
// @description  Central de ferramentas completa para Poké Idle World: Auto Hunt inteligente, Hunt Analyzer (XP/h, Loot e Lucro), Inspetor de IVs & Stats, Analisador de Moves e Log de Capturas.
// @author       You
// @match        https://poke.idleworld.online/play
// @run-at       document-start
// @homepage     https://github.com/AndreSoares92/Poke-Idle-World
// @icon         https://poke.idleworld.online/favicon.ico
// @updateURL    https://raw.githubusercontent.com/AndreSoares92/Poke-Idle-World/main/poke-idle-world.js
// @downloadURL  https://raw.githubusercontent.com/AndreSoares92/Poke-Idle-World/main/poke-idle-world.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    // ========== PROXY INJECTION (INTERCEPTAÇÃO DIRETA NO CONTEXTO DA PÁGINA) ==========
    try {
        const injectScript = document.createElement('script');
        injectScript.textContent = `
            (() => {
                const origWS = window.WebSocket;
                window.WebSocket = new Proxy(origWS, {
                    construct(target, args) {
                        const ws = new target(...args);
                        ws.addEventListener('message', (event) => {
                            if (typeof event.data === 'string') {
                                window.postMessage({ __piwHelper: true, source: 'ws', data: event.data }, '*');
                            }
                        });
                        return ws;
                    }
                });
                window.WebSocket.prototype = origWS.prototype;

                const origFetch = window.fetch;
                window.fetch = async function(...args) {
                    const resp = await origFetch.apply(this, args);
                    try {
                        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
                        const clone = resp.clone();
                        const text = await clone.text();
                        window.postMessage({ __piwHelper: true, source: 'fetch:' + url, data: text }, '*');
                    } catch(e) {}
                    return resp;
                };

                const origXHR = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    this.addEventListener('load', () => {
                        try {
                            if (typeof this.responseText === 'string') {
                                window.postMessage({ __piwHelper: true, source: 'xhr:' + url, data: this.responseText }, '*');
                            }
                        } catch(e) {}
                    });
                    return origXHR.call(this, method, url, ...rest);
                };
            })();
        `;
        (document.head || document.documentElement).appendChild(injectScript);
        injectScript.remove();
    } catch(e) {}

    // ========== CONFIG (persistida) ==========
    const SCRIPT_VERSION = '3.4.4';
    const KILL_TARGET    = GM_getValue('piw_killTarget', 100);
    const CAPTURE_TARGET = GM_getValue('piw_captureTarget', 1);
    let enabled          = false; // Sempre começa pausado ao abrir ou atualizar a página
    GM_setValue('piw_enabled', false);
    let selectedPokemon  = GM_getValue('piw_selectedPokemon', []); // Array de nomes

    // Cidades (não troca automaticamente e pausa o cronômetro)
    const CITY_SLUGS = new Set([
        'cerulean', 'pewter', 'viridian', 'cassino', 'casino', 'lavender',
        'pallet', 'pallet-town', 'vermilion', 'celadon', 'fuchsia', 'saffron', 'cinnabar',
        'city', 'town', 'village', 'depot', 'center', 'market', 'home', 'pokecenter'
    ]);

    function isCity() {
        // 1. Verifica elementos e botões de NPCs no DOM (Nurse Joy, Depot, TM Researcher, Conversar, Abrir Depot)
        const buttons = document.querySelectorAll('button, div, span, p, a');
        for (const el of buttons) {
            if (el.closest('#piw-tracker-window, .piw-panel, #piw-info-window, #piw-moves-window, [id^="piw-"]')) continue;
            const t = (el.textContent || '').trim();
            if (t === 'Abrir Depot' || t === 'Conversar' || t === 'Nurse Joy' || t === 'TM Researcher' || t === 'Depot' || /abrir depot/i.test(t)) {
                return true;
            }
        }

        // 2. Se o body contiver Nurse Joy ou Abrir Depot
        const bodyTxt = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        if (/nurse joy|abrir depot|tm researcher/i.test(bodyTxt)) {
            return true;
        }

        // 3. Botão dock Home ativo
        const homeBtn = document.querySelector('button.dock-btn[data-guide="dock-home"], button.dock-btn.active');
        if (homeBtn && (homeBtn.getAttribute('data-guide') === 'dock-home' || homeBtn.classList.contains('active'))) {
            return true;
        }

        // 4. Slugs e nomes de rota específicos de cidade
        const slug = (currentSlug || '').toLowerCase().trim();
        const route = (currentRoute || '').toLowerCase().trim();

        if (slug && CITY_SLUGS.has(slug)) return true;
        if (route && CITY_SLUGS.has(route)) return true;

        const cityPattern = /cidade|city|town|village|cassino|casino|depot|center|market|pallet|viridian|pewter|cerulean|vermilion|lavender|celadon|fuchsia|saffron|cinnabar|pokecenter/i;
        if (slug && cityPattern.test(slug)) return true;
        if (route && cityPattern.test(route)) return true;

        // 5. Interface de cidade
        if (document.querySelector('.city-container, .city-view, .city-map, [class*="city-screen"], [class*="city-root"], [class*="depot-modal"]')) {
            return true;
        }

        if (!slug && !route) return true;

        return false;
    }

    function getDisplayHuntName(ignoreSession = false) {
        if (isCity()) {
            return 'Cidade / Centro Pokémon';
        }

        // 1. Alvo ativo do Auto Hunt
        if (huntingPokemon && !/^(kanto|outland|johto|hoenn|sinnoh)$/i.test(huntingPokemon)) {
            return cleanPokemonName(huntingPokemon);
        }

        // 2. Inimigo ou alvo no DOM (batalha em andamento no campo, fora de modais/mapas)
        const enemyEl = document.querySelector('.wild-name, .enemy-name, [class*="wild"] .name, [class*="enemy"] .name, [class*="target"] .name, [class*="mob"] .name');
        if (enemyEl && !enemyEl.closest('.map-overlay, .map-container, [class*="map-modal"], [class*="map-content"], .piw-modal, [id^="piw-"]')) {
            const clean = cleanPokemonName(enemyEl.textContent);
            if (clean && !/^(kanto|outland|johto|hoenn|sinnoh)$/i.test(clean)) return clean;
        }

        // 3. Rota atual do jogo
        if (currentRoute && !/^(kanto|outland|johto|hoenn|sinnoh)$/i.test(currentRoute.trim())) {
            return cleanPokemonName(currentRoute);
        }
        if (currentSlug && !/^(kanto|outland|johto|hoenn|sinnoh)$/i.test(currentSlug.trim())) {
            return cleanPokemonName(currentSlug);
        }

        // 4. Nome registrado na sessão
        if (!ignoreSession && huntSession?.huntName && !/^(kanto|outland|johto|hoenn|sinnoh|cidade|centro)$/i.test(huntSession.huntName.trim())) {
            return cleanPokemonName(huntSession.huntName);
        }

        return 'Caça Ativa';
    }

    // ========== SISTEMA DE TIPOS ==========
    // Quais tipos são FORTE contra cada tipo (quem o tipo é efetivo contra)
    const TYPE_SUPER_EFFECTIVE = {
        NORMAL:   [],
        FIRE:     ['GRASS', 'ICE', 'BUG', 'STEEL'],
        WATER:    ['FIRE', 'GROUND', 'ROCK'],
        GRASS:    ['WATER', 'GROUND', 'ROCK'],
        ELECTRIC: ['WATER', 'FLYING'],
        ICE:      ['GRASS', 'GROUND', 'FLYING', 'DRAGON'],
        BUG:      ['GRASS', 'PSYCHIC', 'DARK'],
        POISON:   ['GRASS', 'FAIRY'],
        GROUND:   ['FIRE', 'ELECTRIC', 'POISON', 'ROCK', 'STEEL'],
        ROCK:     ['FIRE', 'ICE', 'BUG', 'FLYING'],
        FLYING:   ['GRASS', 'BUG', 'FIGHTING'],
        PSYCHIC:  ['FIGHTING', 'POISON'],
        GHOST:    ['PSYCHIC', 'GHOST'],
        DRAGON:   ['DRAGON'],
        DARK:     ['PSYCHIC', 'GHOST'],
        STEEL:    ['ICE', 'ROCK', 'FAIRY'],
        FAIRY:    ['FIGHTING', 'DRAGON', 'DARK'],
        FIGHTING: ['NORMAL', 'ICE', 'ROCK', 'DARK', 'STEEL'],
    };

    const TYPE_WEAK_TO = {
        NORMAL:   ['FIGHTING'],
        FIRE:     ['WATER', 'GROUND', 'ROCK'],
        WATER:    ['GRASS', 'ELECTRIC'],
        GRASS:    ['FIRE', 'ICE', 'POISON', 'FLYING', 'BUG'],
        ELECTRIC: ['GROUND'],
        ICE:      ['FIRE', 'FIGHTING', 'ROCK', 'STEEL'],
        FIGHTING: ['FLYING', 'PSYCHIC', 'FAIRY'],
        POISON:   ['GROUND', 'PSYCHIC'],
        GROUND:   ['WATER', 'GRASS', 'ICE'],
        FLYING:   ['ELECTRIC', 'ICE', 'ROCK'],
        PSYCHIC:  ['BUG', 'GHOST', 'DARK'],
        BUG:      ['FIRE', 'FLYING', 'ROCK'],
        ROCK:     ['WATER', 'GRASS', 'FIGHTING', 'GROUND', 'STEEL'],
        GHOST:    ['GHOST', 'DARK'],
        DRAGON:   ['ICE', 'DRAGON', 'FAIRY'],
        DARK:     ['FIGHTING', 'BUG', 'FAIRY'],
        STEEL:    ['FIRE', 'FIGHTING', 'GROUND'],
        FAIRY:    ['POISON', 'STEEL'],
    };

    const TYPE_COLORS = {
        NORMAL: '#a8a878', FIRE: '#f08030', WATER: '#6890f0', GRASS: '#78c850',
        ELECTRIC: '#f8d030', ICE: '#98d8d8', BUG: '#a8b820', POISON: '#a040a0',
        GROUND: '#e0c068', ROCK: '#b8a038', FLYING: '#a890f0', PSYCHIC: '#f85888',
        GHOST: '#705898', DRAGON: '#7038f8', DARK: '#705848', STEEL: '#b8b8d0',
        FAIRY: '#ee99ac', FIGHTING: '#c03028',
    };

    // Retorna os tipos que são fracos contra os tipos do pokémon líder
    function getWeakTypesAgainstLeader(leaderTypes) {
        const weakTypes = new Set();
        for (const type of leaderTypes) {
            const effective = TYPE_SUPER_EFFECTIVE[type] || [];
            effective.forEach(t => weakTypes.add(t));
        }
        return [...weakTypes];
    }

    // Verifica se um pokémon é fraco contra o líder
    function isWeakAgainstLeader(pokemonName, leaderTypes) {
        if (!leaderTypes || leaderTypes.length === 0) return true; // Se não tem líder, mostra todos
        const creature = creatures.find(c => c.name?.toLowerCase() === pokemonName.toLowerCase());
        if (!creature) return true; // Se não encontrou o creature, mostra por precaução
        const pokeTypes = [creature.type1, creature.type2].filter(Boolean);
        const weakTypes = getWeakTypesAgainstLeader(leaderTypes);
        // O pokémon é fraco se qualquer um dos seus tipos é fraco contra o líder
        return pokeTypes.some(t => weakTypes.includes(t));
    }

    // Tabela fixa dos pokémons que têm versão shiny no jogo (167 espécies)
    const SHINY_SPECIES_IDS = new Set([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 31, 34, 36, 38, 40,
        41, 43, 44, 45, 46, 47, 48, 49, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 65, 66, 67, 68, 72, 73, 74, 75, 76, 78, 79, 80, 81, 82, 83,
        84, 85, 88, 89, 90, 91, 92, 93, 94, 95, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 109, 110, 111, 112, 114, 116, 117, 118, 121, 122, 123, 124, 125, 126,
        127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 143, 147, 148, 152, 153, 154, 155, 156, 157, 159, 160, 168, 169, 171, 175, 177, 178, 179, 181, 186, 196, 197, 203, 204, 208,
        210, 211, 213, 217, 218, 219, 220, 221, 222, 228, 229, 230, 231, 232, 234, 236, 241, 246, 247, 252, 256, 257, 259, 260, 280, 281, 282, 304, 305, 306, 310, 447, 448, 472
    ]);

    // ========== DADOS DO IV HELPER ==========
    const BASE_STATS_TABLE = {
        1:[45,49,49,65,65,45], 2:[60,62,63,80,80,60], 3:[80,82,83,100,100,80], 4:[39,52,43,60,50,65], 5:[58,64,58,80,65,80],
        6:[78,84,78,109,85,100], 7:[44,48,65,50,64,43], 8:[59,63,80,65,80,58], 9:[79,83,100,85,105,78], 10:[45,30,35,20,20,45],
        11:[50,20,55,25,25,30], 12:[60,45,50,90,80,70], 13:[40,35,30,20,20,50], 14:[45,25,50,25,25,35], 15:[65,90,40,45,80,75],
        16:[40,45,40,35,35,56], 17:[63,60,55,50,50,71], 18:[83,80,75,70,70,101], 19:[30,56,35,25,35,72], 20:[55,81,60,50,70,97],
        21:[40,60,30,31,31,70], 22:[65,90,65,61,61,100], 23:[35,60,44,40,54,55], 24:[60,95,69,65,79,80], 25:[35,55,40,50,50,90],
        26:[60,90,55,90,80,110], 27:[50,75,85,20,30,40], 28:[75,100,110,45,55,65], 29:[55,47,52,40,40,41], 30:[70,62,67,55,55,56],
        31:[90,92,87,75,85,76], 32:[46,57,40,40,40,50], 33:[61,72,57,55,55,65], 34:[81,102,77,85,75,85], 35:[70,45,48,60,65,35],
        36:[95,70,73,95,90,60], 37:[38,41,40,50,65,65], 38:[73,76,75,81,100,100], 39:[115,45,20,45,25,20], 40:[140,70,45,85,50,45],
        41:[40,45,35,30,40,55], 42:[75,80,70,65,75,90], 43:[45,50,55,75,65,30], 44:[60,65,70,85,75,40], 45:[75,80,85,110,90,50],
        46:[35,70,55,45,55,25], 47:[60,95,80,60,80,30], 48:[60,55,50,40,55,45], 49:[70,65,60,90,75,90], 50:[10,55,25,35,45,95],
        51:[35,100,50,50,70,120], 52:[40,45,35,40,40,90], 53:[65,70,60,65,65,115], 54:[50,52,48,65,50,55], 55:[80,82,78,95,80,85],
        56:[40,80,35,35,45,70], 57:[65,105,60,60,70,95], 58:[55,70,45,70,50,60], 59:[90,110,80,100,80,95], 60:[40,50,40,40,40,90],
        61:[65,65,65,50,50,90], 62:[90,95,95,70,90,70], 63:[25,20,15,105,55,90], 64:[40,35,30,120,70,105], 65:[55,50,45,135,95,120],
        66:[70,80,50,35,35,35], 67:[80,100,70,50,60,45], 68:[90,130,80,65,85,55], 69:[50,75,35,70,30,40], 70:[65,90,50,85,45,55],
        71:[80,105,65,100,70,70], 72:[40,40,35,50,100,70], 73:[80,70,65,80,120,100], 74:[40,80,100,30,30,20], 75:[55,95,115,45,45,35],
        76:[80,120,130,55,65,45], 77:[50,85,55,65,65,90], 78:[65,100,70,80,80,105], 79:[90,65,65,40,40,15], 80:[95,75,110,100,80,30],
        81:[25,35,70,95,55,45], 82:[50,60,95,120,70,70], 83:[52,90,55,58,62,60], 84:[35,85,45,35,35,75], 85:[60,110,70,60,60,110],
        86:[65,45,55,45,70,45], 87:[90,70,80,70,95,70], 88:[80,80,50,40,50,25], 89:[105,105,75,65,100,50], 90:[30,65,100,45,25,40],
        91:[50,95,180,85,45,70], 92:[30,35,30,100,35,80], 93:[45,50,45,115,55,95], 94:[60,65,60,130,75,110], 95:[35,45,160,30,45,70],
        96:[60,48,45,43,90,42], 97:[85,73,70,73,115,67], 98:[30,105,90,25,25,50], 99:[55,130,115,50,50,75], 100:[40,30,50,55,55,100],
        101:[60,50,70,80,80,150], 102:[60,40,80,60,45,40], 103:[95,95,85,125,75,55], 104:[50,50,95,40,50,35], 105:[60,80,110,50,80,45],
        106:[50,120,53,35,110,87], 107:[50,105,79,35,110,76], 108:[90,55,75,60,75,30], 109:[40,65,95,60,45,35], 110:[65,90,120,85,70,60],
        111:[80,85,95,30,30,25], 112:[105,130,120,45,45,40], 113:[250,5,5,35,105,50], 114:[65,55,115,100,40,60], 115:[105,95,80,40,80,90],
        116:[30,40,70,70,25,60], 117:[55,65,95,95,45,85], 118:[45,67,60,35,50,63], 119:[80,92,65,65,80,68], 120:[30,45,55,70,55,85],
        121:[60,75,85,100,85,115], 122:[40,45,65,100,120,90], 123:[70,110,80,55,80,105], 124:[65,50,35,115,95,95], 125:[65,83,57,95,85,105],
        126:[65,95,57,100,85,93], 127:[65,125,100,55,70,85], 128:[75,100,95,40,70,110], 129:[20,10,55,15,20,80], 130:[95,125,79,60,100,81],
        131:[130,85,80,85,95,60], 132:[48,48,48,48,48,48], 133:[55,55,50,45,65,55], 134:[130,65,60,110,95,65], 135:[65,65,60,110,95,130],
        136:[65,130,60,95,110,65], 137:[65,60,70,85,75,40], 138:[35,40,100,90,55,35], 139:[70,60,125,115,70,55], 140:[30,80,90,55,45,55],
        141:[60,115,105,65,70,80], 142:[80,105,65,60,75,130], 143:[160,110,65,65,110,30], 144:[90,85,100,95,125,85], 145:[90,90,85,125,90,100],
        146:[90,100,90,125,85,90], 147:[41,64,45,50,50,50], 148:[61,84,65,70,70,70], 149:[91,134,95,100,100,80], 150:[106,110,90,154,90,130],
        151:[100,100,100,100,100,100], 152:[45,49,65,49,65,45], 153:[60,62,80,63,80,60], 154:[80,82,100,83,100,80], 155:[39,52,43,60,50,65],
        156:[58,64,58,80,65,80], 157:[78,84,78,109,85,100], 158:[50,65,64,44,48,43], 159:[65,80,80,59,63,58], 160:[85,105,100,79,83,78],
        161:[35,46,34,35,45,20], 162:[85,76,64,45,55,90], 163:[60,30,30,36,56,50], 164:[100,50,50,86,96,70], 165:[40,20,30,40,80,55],
        166:[55,35,50,55,110,85], 167:[40,60,40,40,40,30], 168:[70,90,70,60,70,40], 169:[85,90,80,70,80,130], 170:[75,38,38,56,56,67],
        171:[125,58,58,76,76,67], 172:[20,40,15,35,35,60], 173:[50,25,28,45,55,15], 174:[90,30,15,40,20,15], 175:[35,20,65,40,65,20],
        176:[55,40,85,80,105,40], 177:[40,50,45,70,45,70], 178:[65,75,70,95,70,95], 179:[55,40,40,65,45,35], 180:[70,55,55,80,60,45],
        181:[90,75,85,115,90,55], 182:[75,80,95,90,100,50], 183:[70,20,50,20,50,40], 184:[100,50,80,60,80,50], 185:[70,100,115,30,65,30],
        186:[90,75,75,90,100,70], 187:[35,35,40,35,55,50], 188:[55,45,50,45,65,80], 189:[75,55,70,55,95,110], 190:[55,70,55,40,55,85],
        191:[30,30,30,30,30,30], 192:[75,75,55,105,85,30], 193:[65,65,45,75,45,95], 194:[55,45,45,25,25,15], 195:[95,85,85,65,65,35],
        196:[65,65,60,130,95,110], 197:[95,65,110,60,130,65], 198:[60,85,42,85,42,91], 199:[95,75,80,100,110,30], 200:[60,60,60,85,85,85],
        201:[48,72,48,72,48,48], 202:[190,33,58,33,58,33], 203:[70,80,65,90,65,85], 204:[50,65,90,35,35,15], 205:[75,90,140,60,60,40],
        206:[100,70,70,65,65,45], 207:[65,75,105,35,65,85], 208:[75,85,200,55,65,30], 209:[60,80,50,40,40,30], 210:[90,120,75,60,60,45],
        211:[65,95,85,55,55,85], 212:[70,130,100,55,80,65], 213:[20,10,230,10,230,5], 214:[80,125,75,40,95,85], 215:[55,95,55,35,75,115],
        216:[60,80,50,50,50,40], 217:[90,130,75,75,75,55], 218:[40,40,40,70,40,20], 219:[60,50,120,90,80,30], 220:[50,50,40,30,30,50],
        221:[100,100,80,60,60,50], 222:[65,55,95,65,95,35], 223:[35,65,35,65,35,65], 224:[75,105,75,105,75,45], 225:[45,55,45,65,45,75],
        226:[85,40,70,80,140,70], 227:[65,80,140,40,70,70], 228:[45,60,30,80,50,65], 229:[75,90,50,110,80,95], 230:[75,95,95,95,95,85],
        231:[90,60,60,40,40,40], 232:[90,120,120,60,60,50], 233:[85,80,90,105,95,60], 234:[73,95,62,85,65,85], 235:[55,20,35,20,45,75],
        236:[35,35,35,35,35,35], 237:[50,95,95,35,110,70], 238:[45,30,15,85,65,65], 239:[45,63,37,65,55,95], 240:[45,75,37,70,55,83],
        241:[95,80,105,40,70,100], 242:[255,10,10,75,135,55], 243:[90,85,75,115,100,115], 244:[115,115,85,90,75,100], 245:[100,75,115,90,115,85],
        246:[50,64,50,45,50,41], 247:[70,84,70,65,70,51], 248:[100,134,110,95,100,61], 249:[106,90,130,90,154,110], 250:[106,130,90,110,154,90],
        251:[100,100,100,100,100,100]
    };

    const STAT_KEYS = ["hp","atk","def","spAtk","spDef","speed"];
    const STAT_LABELS = {hp:"HP",atk:"Atk",def:"Def",spAtk:"SpA",spDef:"SpD",speed:"Spe"};
    const STAT_COLORS = {hp:"#7ac74c",atk:"#f08030",def:"#f8d030",spAtk:"#6890f0",spDef:"#78c8b0",speed:"#f85888"};

    const TYPE_CHART_FULL = {
        normal:{rock:.5,ghost:0,steel:.5},
        fire:{fire:.5,water:.5,grass:2,ice:2,bug:2,rock:.5,dragon:.5,steel:2},
        water:{fire:2,water:.5,grass:.5,ground:2,rock:2,dragon:.5},
        electric:{water:2,electric:.5,grass:.5,ground:0,flying:2,dragon:.5},
        grass:{fire:.5,water:2,grass:.5,poison:.5,ground:2,flying:.5,bug:.5,rock:2,dragon:.5,steel:.5},
        ice:{fire:.5,water:.5,grass:2,ice:.5,ground:2,flying:2,dragon:2,steel:.5},
        fighting:{normal:2,ice:2,poison:.5,flying:.5,psychic:.5,bug:.5,rock:2,ghost:0,dark:2,steel:2,fairy:.5},
        poison:{grass:2,poison:.5,ground:.5,rock:.5,ghost:.5,steel:0,fairy:2},
        ground:{fire:2,electric:2,grass:.5,poison:2,flying:0,bug:.5,rock:2,steel:2},
        flying:{electric:.5,grass:2,fighting:2,bug:2,rock:.5,steel:.5},
        psychic:{fighting:2,poison:2,psychic:.5,dark:0,steel:.5},
        bug:{fire:.5,grass:2,fighting:.5,poison:.5,flying:.5,psychic:2,ghost:.5,dark:2,steel:.5,fairy:.5},
        rock:{fire:2,ice:2,fighting:.5,ground:.5,flying:2,bug:2,steel:.5},
        ghost:{normal:0,psychic:2,ghost:2,dark:.5},
        dragon:{dragon:2,steel:.5,fairy:0},
        dark:{fighting:.5,psychic:2,ghost:2,dark:.5,fairy:.5},
        steel:{fire:.5,water:.5,electric:.5,ice:2,rock:2,steel:.5,fairy:2},
        fairy:{fire:.5,fighting:2,poison:.5,dragon:2,dark:2,steel:.5}
    };

    const TYPE_COLORS_MAP = {
        normal:"#a8a878",fire:"#f08030",water:"#6890f0",electric:"#f8d030",grass:"#78c850",
        ice:"#98d8d8",fighting:"#c03028",poison:"#a040a0",ground:"#e0c068",flying:"#a890f0",
        psychic:"#f85888",bug:"#a8b820",rock:"#b8a038",ghost:"#705898",dragon:"#7038f8",
        dark:"#705848",steel:"#b8b8d0",fairy:"#ee99ac"
    };

    const TYPE_PT_MAP = {
        normal:"Normal",fire:"Fogo",water:"Água",electric:"Elétrico",grass:"Planta",
        ice:"Gelo",fighting:"Lutador",poison:"Veneno",ground:"Terra",flying:"Voador",
        psychic:"Psíquico",bug:"Inseto",rock:"Pedra",ghost:"Fantasma",dragon:"Dragão",
        dark:"Sombrio",steel:"Aço",fairy:"Fada"
    };

    function getTypeLabelPT(t) {
        if (!t) return '';
        const key = String(t).toLowerCase().trim();
        const label = TYPE_PT_MAP[key] || t;
        return String(label).toUpperCase();
    }

    const CLANS_MAP = {
        ironhard:{name:"Ironhard",types:["steel"],color:"#b8b8d0"},
        naturia:{name:"Naturia",types:["grass","bug"],color:"#78c850"},
        seavell:{name:"Seavell",types:["water","ice"],color:"#6890f0"},
        malefic:{name:"Malefic",types:["ghost","dark","poison"],color:"#705898"},
        orebound:{name:"Orebound",types:["rock","ground"],color:"#b8a038"},
        psycraft:{name:"Psycraft",types:["psychic","fairy"],color:"#f85888"},
        raibolt:{name:"Raibolt",types:["electric"],color:"#f8d030"},
        volcanic:{name:"Volcanic",types:["fire"],color:"#f08030"},
        gardestrike:{name:"Gardestrike",types:["fighting","normal"],color:"#c03028"},
        wingeon:{name:"Wingeon",types:["flying","dragon"],color:"#a890f0"}
    };

    const QUALITY_EXP = {hp:.95,atk:.8,def:.8,spAtk:.8,spDef:.8,speed:.95};

    const QUALITY_TIERS = [
        { min: 3, name: "Divina", color: "#e0f2fe" },
        { min: 2.6, name: "Antiga", color: "#d97706" },
        { min: 1.8, name: "Mítica", color: "#ec4899" },
        { min: 1.7, name: "Lendária", color: "#f97316" },
        { min: 1.5, name: "Épica", color: "#facc15" },
        { min: 1.3, name: "Rara", color: "#a855f7" },
        { min: 1.1, name: "Incomum", color: "#38bdf8" },
        { min: 1, name: "Comum", color: "#22c55e" },
        { min: -Infinity, name: "Fraca", color: "#94a3b8" }
    ];

    function getBaseStatsForSpecies(speciesId) {
        const table = BASE_STATS_TABLE[Number(speciesId)];
        if (!table) return null;
        return { hp: table[0], atk: table[1], def: table[2], spAtk: table[3], spDef: table[4], speed: table[5] };
    }

    function calculateStatFormula(base, iv, level, qualPow) {
        return Math.max(0, Math.floor((base + 2 * iv) * level / 100 * qualPow));
    }

    function calculateMaxHpFormula(baseHp, iv, level, qualPow) {
        return Math.max(1, Math.floor((baseHp + 2 * iv) * level / 100 * qualPow) + level + 22);
    }

    function computeExactIVs(pokemon) {
        if (!pokemon) return null;
        const quality = Number(pokemon.quality || 1);
        const resolved = resolvePokemonSpecies(pokemon.name, pokemon.speciesId || pokemon.pokeId);
        const baseStats = getBaseStatsForSpecies(resolved.speciesId || pokemon.speciesId || pokemon.pokeId);
        if (!baseStats) return null;

        const level = Number(pokemon.level || 1);
        const statsObj = pokemon.stats;
        const ivTotal = Number(pokemon.ivTotal);

        const result = {};

        if (statsObj && Object.keys(statsObj).length > 0) {
            for (const key of STAT_KEYS) {
                const qualPow = Math.pow(quality, QUALITY_EXP[key]);
                const currentVal = Number(statsObj[key]);
                let candidates = [];
                let minDiff = Infinity;

                if (Number.isFinite(currentVal)) {
                    for (let iv = 0; iv <= 32; iv++) {
                        const diff = Math.abs(calculateStatFormula(baseStats[key], iv, level, qualPow) - currentVal);
                        if (diff < minDiff) {
                            minDiff = diff;
                            candidates = [iv];
                        } else if (diff === minDiff) {
                            candidates.push(iv);
                        }
                    }
                }
                if (candidates.length === 0) candidates = [0];
                result[key] = { min: candidates[0], max: candidates[candidates.length - 1] };
            }
        } else if (Number.isFinite(ivTotal) && ivTotal > 0) {
            const avgIV = Math.round(ivTotal / 6);
            const minIV = Math.max(0, Math.min(31, avgIV - 4));
            const maxIV = Math.max(0, Math.min(31, avgIV + 4));
            for (const key of STAT_KEYS) {
                result[key] = { min: minIV, max: maxIV };
            }
        } else {
            for (const key of STAT_KEYS) {
                result[key] = { min: 15, max: 15 };
            }
        }

        if (Number.isFinite(ivTotal) && ivTotal > 0) {
            const avgIV = Math.round(ivTotal / 6);
            for (const key of STAT_KEYS) {
                if (result[key].min === 0 && result[key].max >= 31) {
                    const span = Math.min(5, Math.max(2, Math.round((186 - ivTotal) / 18)));
                    result[key] = {
                        min: Math.max(0, avgIV - span),
                        max: Math.min(31, avgIV + span)
                    };
                }
            }

            for (let pass = 0; pass < 6; pass++) {
                let changed = false;
                for (const key of STAT_KEYS) {
                    let otherMin = 0, otherMax = 0;
                    for (const k of STAT_KEYS) {
                        if (k !== key) {
                            otherMin += result[k].min;
                            otherMax += result[k].max;
                        }
                    }
                    const newMin = Math.max(result[key].min, ivTotal - otherMax);
                    const newMax = Math.min(result[key].max, ivTotal - otherMin);
                    if (newMin > newMax) break;
                    if (newMin !== result[key].min || newMax !== result[key].max) {
                        result[key] = { min: newMin, max: newMax };
                        changed = true;
                    }
                }
                if (!changed) break;
            }
        }
        return result;
    }

    function getQualityTier(qualityNum) {
        const q = Number(qualityNum);
        if (!Number.isFinite(q)) return null;
        for (const tier of QUALITY_TIERS) {
            if (tier.min >= 1.8 ? q > tier.min : q >= tier.min) return tier;
        }
        return QUALITY_TIERS[QUALITY_TIERS.length - 1];
    }

    function getClanForPokemon(pokeTypes, myClanSlug) {
        if (!pokeTypes || pokeTypes.length === 0) return '';
        const typesLower = pokeTypes.map(t => String(t).toLowerCase());
        const matchingClans = Object.entries(CLANS_MAP).filter(([slug, clan]) =>
            clan.types.some(t => typesLower.includes(t))
        ).map(([slug, clan]) => ({ slug, ...clan }));

        if (matchingClans.length === 0) return '';
        const myRank = GM_getValue('piw_clanRank', 1);
        const rankPct = 6 * Math.min(5, Math.max(1, Number(myRank) || 1));

        return matchingClans.map(c => {
            const isMine = myClanSlug && c.slug === myClanSlug;
            return `<span class="piw-iw-chip" style="border-color:${c.color}99;background:${c.color}33" title="Clã ${c.name}">🛡 ${c.name}${isMine ? ` <b style="color:#9fe08a">✓ +${rankPct}%</b>` : ''}</span>`;
        }).join('');
    }

    function calculateMatchupsHtml(pokeTypes) {
        if (!pokeTypes || pokeTypes.length === 0) return "";
        const typesLower = pokeTypes.map(t => String(t).toLowerCase()).filter(t => t in TYPE_CHART_FULL);
        if (typesLower.length === 0) return "";

        const allTypes = Object.keys(TYPE_CHART_FULL);
        const superEffectiveGiven = [];
        const superEffectiveTaken = { 2: [], 4: [], 0: [] };

        for (const targetType of allTypes) {
            let mult = 1;
            for (const pType of typesLower) {
                const chart = TYPE_CHART_FULL[pType] || {};
                mult *= (chart[targetType] ?? 1);
            }
            if (mult >= 2) superEffectiveGiven.push(targetType);
        }

        for (const attackerType of allTypes) {
            const chart = TYPE_CHART_FULL[attackerType] || {};
            let mult = 1;
            for (const pType of typesLower) {
                mult *= (chart[pType] ?? 1);
            }
            if (mult === 2) superEffectiveTaken[2].push(attackerType);
            else if (mult >= 4) superEffectiveTaken[4].push(attackerType);
            else if (mult === 0) superEffectiveTaken[0].push(attackerType);
        }

        const renderRow = (icon, label, typeList, color) => {
            if (!typeList || typeList.length === 0) return "";
            const badges = typeList.map(t => {
                const bg = TYPE_COLORS_MAP[t] || '#888';
                const ptName = TYPE_PT_MAP[t] || t;
                return `<span class="piw-iw-type" style="background:${bg}">${ptName}</span>`;
            }).join(' ');
            return `<div class="piw-iw-eff-row"><span class="piw-iw-eff-label" style="color:${color}">${icon} ${label}</span>${badges}</div>`;
        };

        return `
            ${renderRow("⚔", "Dá 2x+", superEffectiveGiven, "#9fe08a")}
            ${renderRow("🛡", "Toma 4x", superEffectiveTaken[4], "#ff6b6b")}
            ${renderRow("🛡", "Toma 2x", superEffectiveTaken[2], "#ffb04a")}
            ${renderRow("🛡", "Imune", superEffectiveTaken[0], "#9fb0ff")}
        `;
    }

    function getPokemonSpriteUrls(speciesId, isShiny) {
        const id = Number(speciesId);
        if (!Number.isFinite(id) || id <= 0) return null;
        const shinyPath = isShiny ? 'shiny/' : '';
        const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
        return {
            anim: `${base}/versions/generation-v/black-white/animated/${shinyPath}${id}.gif`,
            still: `${base}/${shinyPath}${id}.png`
        };
    }

    function cleanPokemonName(rawName) {
        if (!rawName) return '';
        return rawName
            .replace(/\s*\d+(\.\d+)?%\s*/gi, '')
            .replace(/\s*\([^)]*%\)/gi, '')
            .replace(/\s*\[[^\]]*%\]/gi, '')
            .replace(/\bshiny\b/gi, '')
            .replace(/[✨★☆]/g, '')
            .replace(/\s*\(\s*shiny\s*\)/gi, '')
            .replace(/\s*\[\s*shiny\s*\]/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function resolvePokemonSpecies(name, rawSpeciesId) {
        const numId = Number(rawSpeciesId);
        if (Number.isFinite(numId) && numId > 0 && BASE_STATS_TABLE[numId]) {
            const c = creatures.find(cr => (cr.pokeId || cr.id) === numId);
            return { speciesId: numId, creature: c, baseName: c?.name || name };
        }

        if (!name) return { speciesId: 0, creature: null, baseName: '' };

        const clean = cleanPokemonName(name);

        // 1. Match direto em creatures
        let c = creatures.find(cr => cr.name?.toLowerCase() === clean.toLowerCase());
        if (c) return { speciesId: c.pokeId || c.id, creature: c, baseName: c.name };

        // 2. Extrai espécie base removendo prefixos de variantes/bosses (ex: Brave Clefable -> Clefable, Ancient Meganium -> Meganium)
        const words = clean.split(/\s+/);
        if (words.length > 1) {
            for (let i = 1; i < words.length; i++) {
                const sub = words.slice(i).join(' ');
                c = creatures.find(cr => cr.name?.toLowerCase() === sub.toLowerCase());
                if (c) return { speciesId: c.pokeId || c.id, creature: c, baseName: c.name };
            }
        }

        // 3. Match na última palavra
        const lastWord = words[words.length - 1];
        c = creatures.find(cr => cr.name?.toLowerCase() === lastWord.toLowerCase());
        if (c) return { speciesId: c.pokeId || c.id, creature: c, baseName: c.name };

        return { speciesId: 0, creature: null, baseName: clean };
    }

    function normalizeHuntKey(str) {
        if (!str || typeof str !== 'string') return '';
        return cleanPokemonName(str)
            .toLowerCase()
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatHuntName(str) {
        if (!str || typeof str !== 'string') return 'Rota';
        const cleaned = cleanPokemonName(str).replace(/[-_]+/g, ' ').trim();
        if (!cleaned) return 'Rota';
        return cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }

    function getPartyMonStatsFromDOM(slotIdx, name) {
        const partyMons = document.querySelectorAll(".phud-party .phud-mon");
        let targetMon = null;
        if (typeof slotIdx === 'number' && slotIdx >= 0 && partyMons[slotIdx]) {
            targetMon = partyMons[slotIdx];
        } else if (name) {
            const cleanTarget = cleanPokemonName(name).toLowerCase();
            for (const mon of partyMons) {
                const rawName = mon.querySelector(".phud-name")?.textContent || "";
                if (cleanPokemonName(rawName).toLowerCase() === cleanTarget) {
                    targetMon = mon;
                    break;
                }
            }
        }
        if (!targetMon) {
            targetMon = document.querySelector(".phud-party .phud-mon.active, .phud-party .phud-mon");
        }
        if (!targetMon) return null;

        const hpTxt = targetMon.querySelector(".sbar-hp .sbar-txt")?.textContent?.trim() || "";
        const hpParts = hpTxt.split('/').map(v => Number(v.replace(/\D/g, '')));
        const hpCurrent = hpParts[0];
        const hpMax = hpParts[1];

        const expTxt = targetMon.querySelector(".sbar-exp .sbar-txt, [class*='exp'] .sbar-txt, .exp-txt")?.textContent?.trim() || "";
        const expMatch = expTxt.match(/(\d+(?:\.\d+)?)\s*%/);
        let expPct = expMatch ? parseFloat(expMatch[1]) : null;

        if (expPct === null && expTxt.includes('/')) {
            const expParts = expTxt.split('/').map(v => Number(v.replace(/\D/g, '')));
            if (expParts.length === 2 && expParts[1] > 0) {
                expPct = (expParts[0] / expParts[1]) * 100;
            }
        }

        if (expPct === null) {
            const fill = targetMon.querySelector(".sbar-exp .sbar-fill, .sbar-exp [class*='fill'], [class*='exp'] [class*='fill']");
            if (fill && fill.style.width) {
                const w = parseFloat(fill.style.width);
                if (Number.isFinite(w) && w >= 0) expPct = w;
            }
        }

        return { hpCurrent, hpMax, expPct };
    }

    // Estado do líder e janela flutuante
    let currentLeaderData = null;
    let currentPartyList = [];
    let allPokesList = [];
    let inspectedPokemon = null;
    let isPartySlotPinned = false;
    let infoWindowVisible = GM_getValue('piw_info_win_visible', false);

    let leaderName = '';
    let leaderTypes = [];
    let leaderPokeId = 0;
    let leaderLevel = 0;
    let filterWeakOnly = GM_getValue('piw_filterWeakOnly', false);
    let lastPokesList = []; // Lista anterior de pokémons pra detectar novos shinies
    let shinyAvailable = new Set(); // Nomes dos pokémons que têm versão shiny no jogo
    let filterShinyAvail = GM_getValue('piw_filterShinyAvail', false);
    let loopMode = GM_getValue('piw_loopMode', false);
    let exitOnKills = GM_getValue('piw_exitOnKills', false);
    let exitOnCaptures = GM_getValue('piw_exitOnCaptures', false);

    // ========== STATE ==========
    let killCount      = GM_getValue('piw_killCount', 0);
    let captureCount   = GM_getValue('piw_captureCount', 0);
    let currentRoute   = GM_getValue('piw_currentRoute', '');
    let currentSlug    = GM_getValue('piw_currentSlug', '');
    let huntingPokemon = GM_getValue('piw_huntingPokemon', ''); // Pokémons sendo caçado atualmente
    let busy           = false;
    let socket         = null;
    let creatures      = []; // Todos os pokémons do creatures.json
    let routes         = []; // Todas as rotas do mapa

    function saveState() {
        GM_setValue('piw_killCount', killCount);
        GM_setValue('piw_captureCount', captureCount);
        GM_setValue('piw_currentRoute', currentRoute);
        GM_setValue('piw_currentSlug', currentSlug);
        GM_setValue('piw_huntingPokemon', huntingPokemon);
    }

    // ========== STYLES ==========
    GM_addStyle(`
.piw-panel {
    position: fixed; bottom: 76px; right: 10px; z-index: 2147483000;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 13px; line-height: 1.4;
    width: 320px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
    display: flex; flex-direction: column;
}
.piw-panel-inner {
    padding: 12px;
}
.piw-panel { padding-top: 0 !important; }
.piw-panel h3 {
    margin: 0 0 8px; padding: 10px 14px; font-size: 14px; color: #fff; font-weight: 700;
    letter-spacing: .4px; cursor: grab; display: flex; justify-content: space-between;
    align-items: center; user-select: none;
    background: linear-gradient(135deg, rgba(99,102,241,.38), rgba(76,60,200,.22));
    border-bottom: 1px solid rgba(132,144,255,.22);
}
.piw-panel h3:active { cursor: grabbing; }

.piw-card {
    background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07);
    border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
}
.piw-card-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px;
    color: #93a0e8; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,.08);
}

.piw-panel .piw-btn, #piw-autohunt-window .piw-btn {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #e0e4ef; border-radius: 10px;
    padding: 6px 14px; cursor: pointer; font-size: 12px; transition: all .15s; font-weight: 500;
}
.piw-panel .piw-btn:hover, #piw-autohunt-window .piw-btn:hover { background: rgba(132,144,255,.25); border-color: rgba(132,144,255,.4); }
.piw-panel .piw-btn:active, #piw-autohunt-window .piw-btn:active { background: rgba(132,144,255,.35); }
.piw-panel .piw-btn.piw-btn-primary, #piw-autohunt-window .piw-btn.piw-btn-primary { background: linear-gradient(135deg,#5b7fff,#4a6adf); border: none; color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(91,127,255,.3); }
.piw-panel .piw-btn.piw-btn-primary:hover, #piw-autohunt-window .piw-btn.piw-btn-primary:hover { background: linear-gradient(135deg,#6b8fff,#5a7aef); box-shadow: 0 4px 16px rgba(91,127,255,.4); }

.piw-panel .piw-stat, #piw-autohunt-window .piw-stat { font-size: 15px; font-weight: 700; text-align: center; margin: 1px 0; font-variant-numeric: tabular-nums; }
.piw-panel .piw-stat.piw-kills, #piw-autohunt-window .piw-stat.piw-kills { color: #f0c040; }
.piw-panel .piw-stat.piw-captures, #piw-autohunt-window .piw-stat.piw-captures { color: #4ade80; }

.piw-panel .piw-progress, #piw-autohunt-window .piw-progress { height: 8px; background: rgba(255,255,255,.06); border-radius: 5px; overflow: hidden; margin: 3px 0; border: 1px solid rgba(255,255,255,.08); }
.piw-panel .piw-progress-bar, #piw-autohunt-window .piw-progress-bar { height: 100%; transition: width .3s; border-radius: 5px; }
.piw-bar-kills { background: linear-gradient(90deg,#f0c040,#d4a017); }
.piw-bar-caps { background: linear-gradient(90deg,#4ade80,#22c55e); }

.piw-panel .piw-dual-progress, #piw-autohunt-window .piw-dual-progress { display: flex; gap: 8px; margin: 4px 0; }
.piw-panel .piw-dual-progress-item, #piw-autohunt-window .piw-dual-progress-item { flex: 1; }
.piw-panel .piw-dual-progress-label, #piw-autohunt-window .piw-dual-progress-label { font-size: 11px; color: #cbd5e1; text-align: center; margin-bottom: 2px; font-weight: 600; }
.piw-panel .piw-dual-progress .piw-progress, #piw-autohunt-window .piw-dual-progress .piw-progress { height: 8px; }

.piw-panel .piw-route, #piw-autohunt-window .piw-route { font-size: 12px; color: #cbd5e1; text-align: center; font-weight: 600; }
.piw-panel .piw-leader, #piw-autohunt-window .piw-leader { font-size: 12px; color: #d8b4fe; text-align: center; padding: 2px 0; font-weight: 700; }
.piw-panel .piw-shiny, #piw-autohunt-window .piw-shiny { font-size: 12px; color: #fde047; text-align: center; padding: 2px 0; font-weight: 700; }

.piw-panel .piw-label, #piw-autohunt-window .piw-label { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 12.5px; color: #f1f5f9; font-weight: 600; }
.piw-panel .piw-label input[type=number], #piw-autohunt-window .piw-label input[type=number] {
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); border-radius: 8px;
    color: #fff; padding: 5px 10px; font-size: 12px; width: 80px; font-weight: 700;
}
.piw-panel .piw-label input[type=number]:focus, #piw-autohunt-window .piw-label input[type=number]:focus { outline: none; border-color: #60a5fa; }
.piw-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; position: relative; font-size: 12px; color: #e2e8f0; }
.piw-check input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 18px; height: 18px; border: 2px solid rgba(255,255,255,.25); border-radius: 5px; background: rgba(255,255,255,.08); cursor: pointer; transition: all .15s; flex-shrink: 0; position: relative; }
.piw-check input[type=checkbox]:checked { background: #5b7fff; border-color: #5b7fff; box-shadow: 0 0 8px rgba(91,127,255,.3); }
.piw-check input[type=checkbox]:checked::after { content: ''; position: absolute; left: 4px; top: 0px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.piw-check input[type=checkbox]:hover { border-color: #5b7fff; }
.piw-modal-toolbar .piw-check { font-size: 12px; color: #f1f5f9; font-weight: 600; }

.piw-panel .piw-row, #piw-autohunt-window .piw-row { display: flex; justify-content: space-between; align-items: center; gap: 4px; }

.piw-panel .piw-selected-tags, #piw-autohunt-window .piw-selected-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; min-height: 20px; }
.piw-panel .piw-tag, #piw-autohunt-window .piw-tag {
    background: rgba(74,222,128,.15); border: 1px solid rgba(74,222,128,.4); border-radius: 8px;
    padding: 3px 6px 3px 10px; font-size: 11px; color: #4ade80; font-weight: 700;
    display: flex; align-items: center; gap: 4px;
    cursor: grab;
}
.piw-panel .piw-tag:active, #piw-autohunt-window .piw-tag:active { cursor: grabbing; }
.piw-panel .piw-tag-remove, #piw-autohunt-window .piw-tag-remove {
    cursor: pointer; color: #f87171; font-weight: 800; font-size: 15px; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
    padding: 2px 4px; border-radius: 4px;
    transition: all .15s; user-select: none;
}
.piw-panel .piw-tag-remove:hover, #piw-autohunt-window .piw-tag-remove:hover {
    color: #ff4444; transform: scale(1.25);
}

.piw-panel .piw-hint, #piw-autohunt-window .piw-hint { font-size: 12px; color: #cbd5e1; text-align: center; margin-top: 4px; }

.piw-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 600;
    letter-spacing: .3px; text-transform: uppercase;
}
.piw-badge-running { background: rgba(74,222,128,.12); color: #4ade80; border: 1px solid rgba(74,222,128,.2); }
.piw-badge-paused { background: rgba(248,113,113,.12); color: #f87171; border: 1px solid rgba(248,113,113,.2); }

.piw-panel .piw-city, #piw-autohunt-window .piw-city { font-size: 11px; color: #f0c040; text-align: center; padding: 2px 0; }
.piw-panel .piw-close { cursor: pointer; color: #a5b4fc; font-size: 16px; line-height: 1; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; transition: all .15s; }
.piw-panel .piw-close:hover { color: #fff; background: rgba(255,255,255,.15); }

#piw-reopen {
    visibility: hidden; position: fixed; top: 10px; right: 10px; z-index: 2147483647;
    width: 36px; height: 36px; border-radius: 10px;
    background: linear-gradient(165deg, #161a29, #0d0f18);
    border: 1px solid rgba(132,144,255,.35);
    color: #a5b4fc; font-size: 16px; cursor: grab;
    box-shadow: 0 4px 16px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08);
    display: none; align-items: center; justify-content: center;
    transition: background .15s, border-color .15s, box-shadow .15s, transform .15s; user-select: none;
}
#piw-reopen:active { cursor: grabbing; }
#piw-reopen.piw-dock-mode {
    position: relative !important; top: auto !important; left: auto !important; right: auto !important; bottom: auto !important;
    display: inline-flex !important; align-items: center !important; justify-content: center !important;
    width: 36px !important; height: 36px !important;
    cursor: pointer !important; z-index: 1000; padding: 0 !important;
    box-sizing: border-box !important; flex-shrink: 0;
    border-radius: 6px !important;
    border: 1px solid transparent !important;
    background: transparent !important;
    box-shadow: none !important;
    transition: all .1s ease !important;
}
#piw-reopen.piw-dock-mode svg {
    width: 22px !important; height: 22px !important; display: block !important; margin: auto !important;
    pointer-events: none !important;
}
#piw-reopen.piw-dock-mode:hover {
    border-color: #8f7d54 !important;
    background: rgba(143, 125, 84, 0.22) !important;
    box-shadow: inset 0 0 4px rgba(143, 125, 84, 0.25) !important;
    transform: none !important;
}
#piw-reopen:hover {
    background: linear-gradient(165deg, #22283d, #141826);
    border-color: rgba(132,144,255,.6);
    color: #fff;
    box-shadow: 0 6px 20px rgba(0,0,0,.8), 0 0 12px rgba(132,144,255,.3);
    transform: translateY(-1px);
}
.piw-modal-overlay {
    position: fixed; inset: 0; z-index: 2147483000;
    background: transparent; display: block;
    pointer-events: none;
}
.piw-modal { pointer-events: auto; }
.piw-modal {
    background: linear-gradient(165deg, rgba(20,24,38,.98), rgba(12,14,24,.98));
    border: 1px solid rgba(239,68,68,.35); border-radius: 16px;
    width: 800px; height: 600px;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 16px 50px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(12px);
    position: fixed; top: calc(50vh - 300px); left: calc(50vw - 400px);
    min-width: 500px; min-height: 400px; color: #e7ebf7;
    font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
}
.piw-modal-resize {
    position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px;
    cursor: nwse-resize; z-index: 30; opacity: .6;
    background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(248,113,113,.85) 3px 4.5px);
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
    transition: opacity .15s, transform .15s;
}
.piw-modal-resize:hover { opacity: 1; transform: scale(1.1); }
.piw-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 18px; border-bottom: 1px solid rgba(239,68,68,.25);
    background: linear-gradient(135deg, rgba(239,68,68,.38), rgba(220,38,38,.22));
    cursor: grab; user-select: none;
}
.piw-modal-header:active { cursor: grabbing; }
.piw-modal-header h3 { margin: 0; font-size: 15px; color: #fff; font-weight: 700; letter-spacing: .4px; user-select: none; flex: 1; }
.piw-modal-header .piw-modal-close {
    cursor: pointer; color: #fca5a5; font-size: 18px; background: none;
    border: none; padding: 3px 8px; line-height: 1; border-radius: 6px;
    transition: all .15s;
}
.piw-modal-header .piw-modal-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-modal-toolbar {
    display: flex; gap: 10px; padding: 10px 18px; border-bottom: 1px solid rgba(239,68,68,.18);
    align-items: center; flex-wrap: wrap; background: rgba(255,255,255,.02);
}
.piw-modal-toolbar input[type=text] {
    flex: 1; min-width: 150px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
    border-radius: 10px; color: #e0e4ef; padding: 7px 12px; font-size: 12.5px;
    transition: border-color .15s;
}
.piw-modal-toolbar input[type=text]:focus { outline: none; border-color: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,.25); }
.piw-modal-toolbar input[type=text]::placeholder { color: #7d86ad; }
.piw-modal-toolbar select {
    background: rgba(20,24,38,.9); border: 1px solid rgba(239,68,68,.25); border-radius: 10px;
    color: #e0e4ef; padding: 7px 12px; font-size: 12px; cursor: pointer;
    transition: border-color .15s;
}
.piw-modal-toolbar select:focus { outline: none; border-color: #ef4444; }
.piw-modal-toolbar label:not(.piw-check) {
    display: flex; align-items: center; gap: 5px; font-size: 12px; color: #e2e8f0; cursor: pointer;
    padding: 5px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.06);
    transition: all .15s; font-weight: 500;
}
.piw-modal-toolbar label:not(.piw-check):hover { border-color: #ef4444; color: #fff; background: rgba(239,68,68,.15); }
.piw-modal-toolbar label:not(.piw-check) input { accent-color: #ef4444; }
.piw-modal-toolbar .piw-check input[type=checkbox]:checked { background: #ef4444; border-color: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,.3); }
.piw-modal-toolbar .piw-modal-count {
    font-size: 12px; color: #cbd5e1; font-weight: 600; white-space: nowrap;
}
.piw-modal-body {
    flex: 1; overflow-y: auto; padding: 16px 20px; margin-bottom: 12px;
}
.piw-pokedex-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
    gap: 10px;
}
.piw-poke-card {
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
    padding: 10px 6px; cursor: pointer; text-align: center; transition: all .2s;
    position: relative;
}
.piw-poke-card:hover { border-color: rgba(239,68,68,.45); background: rgba(255,255,255,.09); transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,.4); }
.piw-poke-card.selected { border-color: #4ade80; background: rgba(74,222,128,.18); box-shadow: 0 0 14px rgba(74,222,128,.25); }
.piw-poke-card .piw-poke-img {
    width: 56px; height: 56px; image-rendering: pixelated;
    margin: 0 auto 6px; display: block;
}
.piw-poke-card .piw-poke-num {
    font-size: 10px; color: #cbd5e1; font-weight: 600;
}
.piw-poke-card .piw-poke-name {
    font-size: 11.5px; color: #fff; font-weight: 700;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.piw-poke-card .piw-poke-level {
    font-size: 10px; color: #fde047; font-weight: 700;
}
.piw-poke-card .piw-poke-types {
    display: flex; gap: 3px; justify-content: center; margin-top: 4px;
}
.piw-poke-card .piw-type-badge {
    font-size: 8px; padding: 2px 5px; border-radius: 4px;
    color: #fff; font-weight: 700; text-transform: uppercase; letter-spacing: .3px;
}
.piw-poke-card .piw-poke-check {
    position: absolute; top: 5px; right: 5px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #4ade80; color: #000; font-size: 11px; font-weight: bold;
    display: none; align-items: center; justify-content: center;
    box-shadow: 0 2px 6px rgba(74,222,128,.4);
}
.piw-poke-card.selected .piw-poke-check { display: flex; }
.piw-poke-card .piw-poke-shiny {
    position: absolute; top: 6px; left: 6px; font-size: 12px; z-index: 1;
}
.piw-hunt-card-btn { display: none; position: absolute; top: 6px; left: 6px; background: linear-gradient(135deg,#ef4444,#dc2626); border: none; color: #fff; border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s; z-index: 2; box-shadow: 0 2px 8px rgba(239,68,68,.3); }
.piw-poke-card:hover .piw-hunt-card-btn { display: block; }
.piw-hunt-card-btn:hover { background: linear-gradient(135deg,#f87171,#ef4444); box-shadow: 0 4px 16px rgba(239,68,68,.45); }
.piw-modal-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 20px; border-top: 1px solid rgba(239,68,68,.18);
    background: rgba(255,255,255,.02);
}
.piw-modal-footer .piw-btns-row { display: flex; gap: 8px; }
.piw-modal-footer .piw-btn {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #e0e4ef;
    border-radius: 8px; padding: 7px 16px; cursor: pointer; font-size: 12px;
    transition: all .15s;
}
.piw-modal-footer .piw-btn:hover { background: rgba(239,68,68,.2); border-color: rgba(239,68,68,.4); }
.piw-modal-footer .piw-selected-info { font-size: 13px; color: #9aa3bf; }
.piw-modal-footer .piw-btn-apply {
    background: linear-gradient(135deg, #ef4444, #dc2626); border: none;
    color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(239,68,68,.3);
}
.piw-modal-footer .piw-btn-apply:hover { background: linear-gradient(135deg, #f87171, #ef4444); box-shadow: 0 4px 16px rgba(239,68,68,.4); }
.piw-type-badge {
    display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px;
    color: #fff; font-weight: 700; letter-spacing: .3px; text-transform: uppercase;
    margin: 0 2px; vertical-align: middle;
}

#piw-info-window {
    position: fixed; z-index: 2147483000; width: 340px; min-width: 340px; min-height: 200px;
    display: none; flex-direction: column;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 12px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
}
#piw-info-window * { box-sizing: border-box; }
.piw-iw-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; cursor: grab; border-bottom: 1px solid rgba(139,92,246,.25);
    background: linear-gradient(135deg, rgba(139,92,246,.38), rgba(124,58,237,.22));
    font-weight: 700; font-size: 13px; letter-spacing: .4px;
}
.piw-iw-head:active { cursor: grabbing; }
.piw-iw-title { display: flex; align-items: center; gap: 8px; }
.piw-iw-dot { width: 8px; height: 8px; border-radius: 50%; background: #a78bfa; box-shadow: 0 0 10px #a78bfa; }
.piw-iw-close { cursor: pointer; color: #c4b5fd; font-size: 16px; font-weight: bold; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.piw-iw-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-iw-party-bar { display: flex; gap: 6px; padding: 6px 8px; margin-bottom: 8px; background: rgba(10,12,20,.75); border: 1px solid rgba(132,144,255,.2); border-radius: 10px; overflow-x: auto; align-items: center; justify-content: center; }
.piw-iw-party-slot { position: relative; width: 36px; height: 36px; border-radius: 8px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s ease; flex-shrink: 0; }
.piw-iw-party-slot * { pointer-events: none; }
.piw-iw-party-slot:hover { background: rgba(132,144,255,.15); border-color: rgba(132,144,255,.5); transform: translateY(-2px); }
.piw-iw-party-slot.leader { border-color: rgba(255,213,74,.5); }
.piw-iw-party-slot.inspected { border-color: #a78bfa !important; box-shadow: 0 0 10px rgba(167,139,250,.6) !important; background: rgba(167,139,250,.2) !important; }
.piw-iw-party-slot img { width: 28px; height: 28px; object-fit: contain; }
.piw-iw-party-slot .piw-slot-lv { position: absolute; bottom: 0px; right: 2px; font-size: 8px; font-weight: 700; color: #cbd5e1; text-shadow: 0 1px 2px #000; }
.piw-iw-party-slot .piw-slot-leader { position: absolute; top: -4px; left: -2px; font-size: 10px; line-height: 1; }

.piw-iw-hero { display: flex; gap: 12px; align-items: center; }
.piw-iw-sprite { width: 56px; height: 56px; image-rendering: pixelated; flex: none; object-fit: contain; background: radial-gradient(circle at 50% 40%, rgba(139,124,250,.25), rgba(139,124,250,.05)); border-radius: 10px; }
.piw-iw-name { font-size: 15px; font-weight: 700; color: #fff; }
.piw-iw-lv { color: #93a0e8; font-weight: 600; font-size: 12px; margin-left: 4px; }
.piw-iw-types { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
.piw-iw-type { color: #fff; border-radius: 99px; padding: 2px 9px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; text-shadow: 0 1px 2px rgba(0,0,0,.6); box-shadow: inset 0 0 0 1px rgba(255,255,255,.2); }

.piw-iw-chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.piw-iw-chip { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.09); border-radius: 99px; padding: 2px 9px; font-size: 11px; white-space: nowrap; }
.piw-iw-chip-accent { background: linear-gradient(135deg, rgba(99,102,241,.4), rgba(139,92,246,.3)); border-color: rgba(139,124,250,.4); }

.piw-iw-bar-row { display: flex; align-items: center; gap: 8px; margin: 6px 0 2px; }
.piw-iw-bar-tag { width: 32px; font-size: 10.5px; font-weight: 700; color: #93a0e8; }
.piw-iw-bar { flex: 1; height: 10px; background: rgba(255,255,255,.08); border-radius: 99px; overflow: hidden; }
.piw-iw-bar-fill { height: 100%; border-radius: 99px; }
.piw-iw-bar-val { min-width: 64px; text-align: right; font-size: 11px; color: #e2e8f0; font-weight: 600; font-variant-numeric: tabular-nums; }

.piw-iw-card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); border-radius: 10px; padding: 10px; margin-bottom: 8px; }
.piw-iw-card:last-child { margin-bottom: 0; }
.piw-iw-sec { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #a5b4fc; margin-bottom: 8px; }
.piw-iw-sec small { text-transform: none; letter-spacing: 0; color: #cbd5e1; font-weight: 600; }

.piw-iw-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.piw-iw-stat { background: rgba(255,255,255,.05); border-radius: 8px; padding: 5px 2px 4px; text-align: center; border-top: 2px solid var(--c); }
.piw-iw-stat-name { font-size: 11px; font-weight: 700; color: var(--c); letter-spacing: .5px; }
.piw-iw-stat-val { font-size: 13.5px; font-weight: 700; color: #fff; margin-top: 2px; }
.piw-iw-stat-base { font-size: 11px; color: #cbd5e1; margin-top: 3px; padding-top: 2px; border-top: 1px dashed rgba(255,255,255,.16); font-weight: 500; }
.piw-iw-stat-base b { color: #fff; font-weight: 700; }

.piw-iw-eff-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
.piw-iw-eff-label { min-width: 75px; font-size: 11.5px; font-weight: 600; color: #e2e8f0; }

.piw-iw-iv-row { display: flex; align-items: center; gap: 7px; margin: 5px 0; }
.piw-iw-iv-name { width: 30px; font-size: 11.5px; font-weight: 700; }
.piw-iw-iv-growth { width: 48px; text-align: right; font-size: 11px; color: #cbd5e1; font-weight: 600; font-variant-numeric: tabular-nums; }
.piw-iw-iv-val { min-width: 36px; text-align: center; background: rgba(255,255,255,.1); border-radius: 6px; padding: 1px 5px; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.piw-iw-sum { margin-top: 8px; font-size: 11.5px; font-weight: 600; }

#piw-moves-window {
    position: fixed; z-index: 2147483000; width: 300px;
    display: none; flex-direction: column;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 12px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
}
#piw-moves-window * { box-sizing: border-box; }
.piw-mw-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; cursor: grab; border-bottom: 1px solid rgba(6,182,212,.25);
    background: linear-gradient(135deg, rgba(6,182,212,.38), rgba(8,145,178,.22));
    font-weight: 700; font-size: 13px; letter-spacing: .4px;
}
.piw-mw-head:active { cursor: grabbing; }
.piw-mw-title { display: flex; align-items: center; gap: 8px; }
.piw-mw-dot { width: 8px; height: 8px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 10px #22d3ee; }
.piw-mw-close { cursor: pointer; color: #a5f3fc; font-size: 16px; font-weight: bold; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.piw-mw-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-iw-body { padding: 12px; overflow-y: auto; user-select: text; flex: 1 1 auto; min-height: 0; }
.piw-mw-body { padding: 10px 12px; overflow-y: auto; user-select: text; flex: 1 1 auto; min-height: 0; }
.piw-mw-party-bar { display: flex; gap: 6px; padding: 6px 8px; margin-bottom: 8px; background: rgba(10,12,20,.75); border: 1px solid rgba(6,182,212,.25); border-radius: 10px; overflow-x: auto; align-items: center; justify-content: center; }
.piw-mw-party-slot { position: relative; width: 36px; height: 36px; border-radius: 8px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s ease; flex-shrink: 0; }
.piw-mw-party-slot * { pointer-events: none; }
.piw-mw-party-slot:hover { background: rgba(6,182,212,.15); border-color: rgba(6,182,212,.5); transform: translateY(-2px); }
.piw-mw-party-slot.leader { border-color: rgba(255,213,74,.5); }
.piw-mw-party-slot.inspected { border-color: #22d3ee !important; box-shadow: 0 0 10px rgba(34,211,238,.6) !important; background: rgba(34,211,238,.2) !important; }
.piw-mw-party-slot img { width: 28px; height: 28px; object-fit: contain; }
.piw-mw-party-slot .piw-slot-lv { position: absolute; bottom: 0px; right: 2px; font-size: 8px; font-weight: 700; color: #cbd5e1; text-shadow: 0 1px 2px #000; }
.piw-mw-party-slot .piw-slot-leader { position: absolute; top: -4px; left: -2px; font-size: 10px; line-height: 1; }

.piw-iw-body { scrollbar-width: thin; scrollbar-color: rgba(129,140,248,.5) transparent; }
.piw-mw-body, .piw-mw-party-bar { scrollbar-width: thin; scrollbar-color: rgba(6,182,212,.5) transparent; }
.piw-tw-body { scrollbar-width: thin; scrollbar-color: rgba(16,185,129,.5) transparent; }
.piw-ah-body { scrollbar-width: thin; scrollbar-color: rgba(239,68,68,.5) transparent; }
.piw-cw-body, .piw-cw-list, .piw-cw-qual-bar { scrollbar-width: thin; scrollbar-color: rgba(245,158,11,.5) transparent; }
.piw-modal-body, .piw-panel-inner, [id^="piw-"] { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.25) transparent; }

.piw-iw-body::-webkit-scrollbar,
.piw-mw-body::-webkit-scrollbar,
.piw-mw-party-bar::-webkit-scrollbar,
.piw-tw-body::-webkit-scrollbar,
.piw-ah-body::-webkit-scrollbar,
.piw-cw-body::-webkit-scrollbar,
.piw-cw-list::-webkit-scrollbar,
.piw-cw-qual-bar::-webkit-scrollbar,
.piw-modal-body::-webkit-scrollbar,
.piw-panel-inner::-webkit-scrollbar,
[id^="piw-"] *::-webkit-scrollbar { width: 5px; height: 5px; }

.piw-iw-body::-webkit-scrollbar-track,
.piw-mw-body::-webkit-scrollbar-track,
.piw-mw-party-bar::-webkit-scrollbar-track,
.piw-tw-body::-webkit-scrollbar-track,
.piw-ah-body::-webkit-scrollbar-track,
.piw-cw-body::-webkit-scrollbar-track,
.piw-cw-list::-webkit-scrollbar-track,
.piw-cw-qual-bar::-webkit-scrollbar-track,
.piw-modal-body::-webkit-scrollbar-track,
.piw-panel-inner::-webkit-scrollbar-track,
[id^="piw-"] *::-webkit-scrollbar-track { background: transparent; }

/* Scrollbar Thumbs temáticos para cada janela */
.piw-iw-body::-webkit-scrollbar-thumb { background: rgba(129,140,248,.45); border-radius: 4px; }
.piw-iw-body::-webkit-scrollbar-thumb:hover { background: rgba(165,180,252,.85); }

.piw-mw-body::-webkit-scrollbar-thumb,
.piw-mw-party-bar::-webkit-scrollbar-thumb { background: rgba(6,182,212,.45); border-radius: 4px; }
.piw-mw-body::-webkit-scrollbar-thumb:hover,
.piw-mw-party-bar::-webkit-scrollbar-thumb:hover { background: rgba(34,211,238,.85); }

.piw-tw-body::-webkit-scrollbar-thumb { background: rgba(16,185,129,.45); border-radius: 4px; }
.piw-tw-body::-webkit-scrollbar-thumb:hover { background: rgba(52,211,153,.85); }

.piw-ah-body::-webkit-scrollbar-thumb { background: rgba(239,68,68,.45); border-radius: 4px; }
.piw-ah-body::-webkit-scrollbar-thumb:hover { background: rgba(248,113,113,.85); }

.piw-cw-body::-webkit-scrollbar-thumb,
.piw-cw-list::-webkit-scrollbar-thumb,
.piw-cw-qual-bar::-webkit-scrollbar-thumb { background: rgba(245,158,11,.45); border-radius: 4px; }
.piw-cw-body::-webkit-scrollbar-thumb:hover,
.piw-cw-list::-webkit-scrollbar-thumb:hover,
.piw-cw-qual-bar::-webkit-scrollbar-thumb:hover { background: rgba(251,191,36,.85); }

.piw-modal-body::-webkit-scrollbar-thumb,
.piw-panel-inner::-webkit-scrollbar-thumb,
[id^="piw-"] *::-webkit-scrollbar-thumb { background: rgba(255,255,255,.22); border-radius: 4px; }
.piw-modal-body::-webkit-scrollbar-thumb:hover,
.piw-panel-inner::-webkit-scrollbar-thumb:hover,
[id^="piw-"] *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.45); }

#piw-tracker-window {
    position: fixed; z-index: 2147483000; width: 340px; min-width: 340px; min-height: 200px;
    display: none; flex-direction: column;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 12px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
}
#piw-tracker-window * { box-sizing: border-box; }
.piw-tw-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; cursor: grab; border-bottom: 1px solid rgba(132,144,255,.22);
    background: linear-gradient(135deg, rgba(16,185,129,.38), rgba(5,150,105,.22));
    font-weight: 700; font-size: 13px; letter-spacing: .4px;
}
.piw-tw-head:active { cursor: grabbing; }
.piw-tw-title { display: flex; align-items: center; gap: 8px; }
.piw-tw-dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 10px #34d399; }
.piw-tw-close { cursor: pointer; color: #a7f3d0; font-size: 16px; font-weight: bold; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.piw-tw-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-tw-tabs { display: flex; background: rgba(0,0,0,.25); border-bottom: 1px solid rgba(132,144,255,.15); padding: 4px 8px; gap: 6px; }
.piw-tw-tab { flex: 1; text-align: center; padding: 6px 8px; border-radius: 8px; font-weight: 700; font-size: 11px; cursor: pointer; color: #9aa3bf; background: transparent; border: 1px solid transparent; transition: all .15s; }
.piw-tw-tab:hover { color: #fff; background: rgba(255,255,255,.05); }
.piw-tw-tab.active { color: #34d399; background: rgba(16,185,129,.15); border-color: rgba(16,185,129,.35); box-shadow: 0 0 10px rgba(16,185,129,.2); }
.piw-tw-body { padding: 12px; overflow-y: auto; user-select: text; flex: 1 1 auto; min-height: 0; }
.piw-tw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
.piw-tw-stat { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 9px 10px; }
.piw-tw-stat-title { font-size: 11px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: .5px; display: flex; align-items: center; gap: 4px; }
.piw-tw-stat-val { font-size: 15px; font-weight: 700; color: #fff; margin-top: 3px; }
.piw-tw-stat-sub { font-size: 11.5px; font-weight: 500; color: #e2e8f0; margin-top: 3px; line-height: 1.3; }
.piw-tw-history-item { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 10px; margin-bottom: 8px; position: relative; }
.piw-tw-history-item:hover { border-color: rgba(132,144,255,.3); background: rgba(255,255,255,.06); }
.piw-tw-history-item.best-exp { border-color: rgba(52,211,153,.5); box-shadow: 0 0 10px rgba(52,211,153,.15); }
.piw-tw-badge-best { background: linear-gradient(135deg,#10b981,#059669); color: #fff; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 5px; display: inline-block; margin-left: 6px; }
.piw-tw-sort-btn { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); color: #cbd5e1; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all .15s; }
.piw-tw-sort-btn:hover { background: rgba(255,255,255,.14); color: #fff; }
.piw-tw-sort-btn.active { background: rgba(16, 185, 129, 0.25); border-color: rgba(52, 211, 153, 0.6); color: #34d399; font-weight: 800; }

#piw-autohunt-window {
    position: fixed; z-index: 2147483000; width: 340px; min-width: 320px; min-height: 200px;
    display: none; flex-direction: column;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 12px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
}
#piw-autohunt-window * { box-sizing: border-box; }
.piw-ah-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; cursor: grab; border-bottom: 1px solid rgba(132,144,255,.22);
    background: linear-gradient(135deg, rgba(239,68,68,.38), rgba(220,38,38,.22));
    font-weight: 700; font-size: 13px; letter-spacing: .4px;
}
.piw-ah-head:active { cursor: grabbing; }
.piw-ah-title { display: flex; align-items: center; gap: 8px; }
.piw-ah-dot { width: 8px; height: 8px; border-radius: 50%; background: #f87171; box-shadow: 0 0 10px #f87171; }
.piw-ah-close { cursor: pointer; color: #fca5a5; font-size: 16px; font-weight: bold; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.piw-ah-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-ah-body { padding: 12px; overflow-y: auto; user-select: text; flex: 1 1 auto; min-height: 0; }

#piw-captures-window {
    position: fixed; z-index: 2147483000; width: 375px; min-width: 360px; min-height: 220px;
    display: none; flex-direction: column;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 12px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(245,158,11,.3); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
}
#piw-captures-window * { box-sizing: border-box; }
.piw-cw-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; cursor: grab; border-bottom: 1px solid rgba(245,158,11,.22);
    background: linear-gradient(135deg, rgba(245,158,11,.38), rgba(217,119,6,.22));
    font-weight: 700; font-size: 13px; letter-spacing: .4px;
}
.piw-cw-head:active { cursor: grabbing; }
.piw-cw-title { display: flex; align-items: center; gap: 8px; }
.piw-cw-dot { width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; box-shadow: 0 0 10px #fbbf24; }
.piw-cw-close { cursor: pointer; color: #fde68a; font-size: 16px; font-weight: bold; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.piw-cw-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-cw-body { padding: 12px; overflow-y: auto; user-select: text; flex: 1 1 auto; min-height: 0; }
.piw-cw-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.piw-cw-stat { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 8px 6px; text-align: center; }
.piw-cw-stat-title { font-size: 11px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: .5px; }
.piw-cw-stat-val { font-size: 15px; font-weight: 700; color: #fff; margin-top: 2px; }
.piw-cw-toolbar { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
.piw-cw-search { flex: 1; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; padding: 6px 9px; font-size: 12px; font-weight: 500; }
.piw-cw-search:focus { outline: none; border-color: #f59e0b; }
.piw-cw-btn { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); color: #cbd5e1; font-size: 11.5px; font-weight: 700; padding: 5px 9px; border-radius: 8px; cursor: pointer; transition: all .15s; white-space: nowrap; }
.piw-cw-btn:hover { background: rgba(255,255,255,.12); color: #fff; }
.piw-cw-btn.active { background: rgba(245,158,11,.25); border-color: rgba(245,158,11,.5); color: #fbbf24; font-weight: 800; }
.piw-cw-item { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 9px 10px; margin-bottom: 6px; transition: all .15s; position: relative; }
.piw-cw-item:hover { background: rgba(255,255,255,.07); border-color: rgba(245,158,11,.35); }
.piw-cw-item.shiny { border-color: rgba(251,191,36,.5); background: linear-gradient(135deg, rgba(251,191,36,.12), rgba(245,158,11,.04)); box-shadow: 0 0 12px rgba(251,191,36,.15); }
.piw-cw-item.inspected { border-color: #fbbf24 !important; box-shadow: 0 0 12px rgba(251,191,36,.5) !important; background: rgba(245,158,11,.18) !important; }
.piw-cw-sprite { width: 40px; height: 40px; image-rendering: pixelated; object-fit: contain; flex-shrink: 0; background: rgba(0,0,0,.25); border-radius: 8px; padding: 2px; }
.piw-cw-info { flex: 1; min-width: 0; }
.piw-cw-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.piw-cw-name { font-size: 13.5px; font-weight: 700; color: #fff; }
.piw-cw-lv { font-size: 11.5px; font-weight: 700; color: #fbbf24; }
.piw-cw-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; align-items: center; }
.piw-cw-badge { font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 5px; background: rgba(255,255,255,.08); color: #e2e8f0; }
.piw-cw-meta { text-align: right; flex-shrink: 0; }
.piw-cw-val { font-size: 13.5px; font-weight: 700; color: #4ade80; }
.piw-cw-time { font-size: 11px; font-weight: 600; color: #cbd5e1; margin-top: 3px; }
.piw-cw-qual-bar { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 0 6px; margin-bottom: 6px; align-items: center; }
.piw-cw-qual-pill { padding: 4px 9px; border-radius: 12px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s ease; border: 1px solid transparent; white-space: nowrap; flex-shrink: 0; user-select: none; }
.piw-cw-qual-pill:hover { filter: brightness(1.25); transform: translateY(-1px); }
.piw-cw-qual-pill.active { box-shadow: 0 0 8px currentColor; font-weight: 800; }

.piw-hub-btn {
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px;
    padding: 10px 6px;
    text-align: center;
    cursor: pointer;
    transition: all .2s;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}
.piw-hub-btn:hover {
    background: rgba(255,255,255,.08);
    border-color: rgba(132,144,255,.4);
    transform: translateY(-2px);
    box-shadow: 0 4px 14px rgba(0,0,0,.3);
}

/* Scrollbars customizadas padronizadas */
.piw-panel *, .piw-panel-inner,
#piw-autohunt-window *, .piw-ah-body,
#piw-tracker-window *, .piw-tw-body,
#piw-info-window *, .piw-iw-body,
#piw-moves-window *, .piw-mw-body,
#piw-pokedex-overlay *, .piw-modal * {
    scrollbar-width: thin !important;
}
.piw-panel *::-webkit-scrollbar, .piw-panel-inner::-webkit-scrollbar,
#piw-autohunt-window *::-webkit-scrollbar, .piw-ah-body::-webkit-scrollbar,
#piw-tracker-window *::-webkit-scrollbar, .piw-tw-body::-webkit-scrollbar,
#piw-info-window *::-webkit-scrollbar, .piw-iw-body::-webkit-scrollbar,
#piw-moves-window *::-webkit-scrollbar, .piw-mw-body::-webkit-scrollbar,
#piw-pokedex-overlay *::-webkit-scrollbar, .piw-modal *::-webkit-scrollbar {
    width: 6px !important;
    height: 6px !important;
}
.piw-panel *::-webkit-scrollbar-track, .piw-panel-inner::-webkit-scrollbar-track,
#piw-autohunt-window *::-webkit-scrollbar-track, .piw-ah-body::-webkit-scrollbar-track,
#piw-tracker-window *::-webkit-scrollbar-track, .piw-tw-body::-webkit-scrollbar-track,
#piw-info-window *::-webkit-scrollbar-track, .piw-iw-body::-webkit-scrollbar-track,
#piw-moves-window *::-webkit-scrollbar-track, .piw-mw-body::-webkit-scrollbar-track,
#piw-pokedex-overlay *::-webkit-scrollbar-track, .piw-modal *::-webkit-scrollbar-track {
    background: rgba(20, 24, 38, 0.5) !important;
    border-radius: 99px !important;
}

/* 1. Hub Principal (Índigo) */
.piw-panel *, .piw-panel-inner {
    scrollbar-color: rgba(99, 102, 241, 0.5) rgba(20, 24, 38, 0.4) !important;
}
.piw-panel *::-webkit-scrollbar-thumb, .piw-panel-inner::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #6366f1, #4f46e5) !important;
    border-radius: 99px !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
}
.piw-panel *::-webkit-scrollbar-thumb:hover, .piw-panel-inner::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #818cf8, #6366f1) !important;
}

/* 2. Auto Hunt & Seleção de Pokémon / Pokédex (Vermelho) */
#piw-autohunt-window, #piw-autohunt-window *, .piw-ah-body,
#piw-pokedex-overlay, #piw-pokedex-overlay *, .piw-modal, .piw-modal *, .piw-modal-body, .piw-modal-body * {
    scrollbar-color: rgba(239, 68, 68, 0.5) rgba(20, 24, 38, 0.4) !important;
}
#piw-autohunt-window *::-webkit-scrollbar-thumb, .piw-ah-body::-webkit-scrollbar-thumb,
#piw-pokedex-overlay *::-webkit-scrollbar-thumb, .piw-modal *::-webkit-scrollbar-thumb, .piw-modal-body::-webkit-scrollbar-thumb, .piw-modal-body *::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #ef4444, #dc2626) !important;
    border-radius: 99px !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
}
#piw-autohunt-window *::-webkit-scrollbar-thumb:hover, .piw-ah-body::-webkit-scrollbar-thumb:hover,
#piw-pokedex-overlay *::-webkit-scrollbar-thumb:hover, .piw-modal *::-webkit-scrollbar-thumb:hover, .piw-modal-body::-webkit-scrollbar-thumb:hover, .piw-modal-body *::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #f87171, #ef4444) !important;
}

/* 3. Hunt Analyzer (Esmeralda) */
#piw-tracker-window, #piw-tracker-window *, .piw-tw-body {
    scrollbar-color: rgba(16, 185, 129, 0.5) rgba(15, 23, 42, 0.5) !important;
}
#piw-tracker-window *::-webkit-scrollbar-thumb, .piw-tw-body::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #10b981, #059669) !important;
    border-radius: 99px !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
}
#piw-tracker-window *::-webkit-scrollbar-thumb:hover, .piw-tw-body::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #34d399, #10b981) !important;
}

/* 4. IVs & Stats (Violeta / Roxo) */
#piw-info-window, #piw-info-window *, .piw-iw-body {
    scrollbar-color: rgba(139, 92, 246, 0.5) rgba(20, 24, 38, 0.4) !important;
}
#piw-info-window *::-webkit-scrollbar-thumb, .piw-iw-body::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #8b5cf6, #7c3aed) !important;
    border-radius: 99px !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
}
#piw-info-window *::-webkit-scrollbar-thumb:hover, .piw-iw-body::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #a78bfa, #8b5cf6) !important;
}

/* 5. Moves (Ciano) */
#piw-moves-window, #piw-moves-window *, .piw-mw-body {
    scrollbar-color: rgba(6, 182, 212, 0.5) rgba(20, 24, 38, 0.4) !important;
}
#piw-moves-window *::-webkit-scrollbar-thumb, .piw-mw-body::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #06b6d4, #0891b2) !important;
    border-radius: 99px !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
}
#piw-moves-window *::-webkit-scrollbar-thumb:hover, .piw-mw-body::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #22d3ee, #06b6d4) !important;
}

.piw-win-resize {
    position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px;
    cursor: nwse-resize; z-index: 30; opacity: .6;
    background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(147,160,232,.85) 3px 4.5px);
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
    transition: opacity .15s, transform .15s;
}
.piw-win-resize:hover { opacity: 1; transform: scale(1.1); }

.piw-mw-sub { font-size: 10.5px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: #93a0e8; }
.piw-mw-move { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 9px; border-radius: 8px; margin: 4px 0; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); flex-wrap: wrap; }
.piw-mw-active { border-color: rgba(250,204,21,.65); background: rgba(250,204,21,.10); box-shadow: 0 0 10px rgba(250,204,21,.12); }
.piw-mw-move-name { font-weight: 700; font-size: 12px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; color: #fff; }
.piw-mw-move-lv { font-weight: 700; font-size: 9.5px; color: #93a0e8; background: rgba(147,160,232,.14); border: 1px solid rgba(147,160,232,.3); border-radius: 99px; padding: 1px 5px; }
.piw-mw-move-cls { font-weight: 700; font-size: 9.5px; border: 1px solid; border-radius: 99px; padding: 1px 5px; }
.piw-mw-move-meta { display: flex; align-items: center; gap: 5px; margin-left: auto; }
`);

    // ========== UI & WINDOW FOCUSING ==========
    let highestZIndex = 2147483010;

    function bringToFront(el) {
        if (!el) return;
        highestZIndex++;
        el.style.zIndex = String(highestZIndex);
    }

    function makeBringableToFront(el) {
        if (!el) return;
        el.addEventListener('pointerdown', () => bringToFront(el));
        el.addEventListener('mousedown', () => bringToFront(el));
    }

    // Fechamento de janelas com ESC (da última aberta/focada para a primeira)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.keyCode === 27) {
            // Se estiver em um input de busca ou texto, desfoca primeiro
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                e.target.blur();
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const openWindows = [];

            // 1. Modais de alto nível
            const movesModal = document.getElementById('piw-moves-detail-modal');
            if (movesModal && movesModal.style.display !== 'none' && movesModal.offsetWidth > 0) {
                openWindows.push({ el: movesModal, close: closeMovesDetailModal, z: parseInt(movesModal.style.zIndex) || 2147483500 });
            }

            const historyModal = document.getElementById('piw-history-modal');
            if (historyModal && historyModal.style.display !== 'none' && historyModal.offsetWidth > 0) {
                openWindows.push({ el: historyModal, close: closeHuntHistoryModal, z: parseInt(historyModal.style.zIndex) || 2147483500 });
            }

            const pokedexOverlay = document.getElementById('piw-pokedex-overlay');
            if (pokedexOverlay && pokedexOverlay.style.display !== 'none' && pokedexOverlay.offsetWidth > 0) {
                openWindows.push({
                    el: pokedexOverlay,
                    close: () => {
                        const closeBtn = document.getElementById('piw-pokedex-close');
                        if (closeBtn) closeBtn.click();
                        else pokedexOverlay.style.display = 'none';
                    },
                    z: parseInt(pokedexOverlay.style.zIndex) || 2147483500
                });
            }

            // 2. Janelas flutuantes
            const capturesWin = document.getElementById('piw-captures-window');
            if (capturesWin && capturesWin.style.display !== 'none' && capturesWin.offsetWidth > 0) {
                openWindows.push({ el: capturesWin, close: closeCapturesWindow, z: parseInt(capturesWin.style.zIndex) || 2147483000 });
            }

            const movesWin = document.getElementById('piw-moves-window');
            if (movesWin && movesWin.style.display !== 'none' && movesWin.offsetWidth > 0) {
                openWindows.push({ el: movesWin, close: closeMovesWindow, z: parseInt(movesWin.style.zIndex) || 2147483000 });
            }

            const infoWin = document.getElementById('piw-info-window');
            if (infoWin && infoWin.style.display !== 'none' && infoWin.offsetWidth > 0) {
                openWindows.push({ el: infoWin, close: closeInfoWindow, z: parseInt(infoWin.style.zIndex) || 2147483000 });
            }

            const trackerWin = document.getElementById('piw-tracker-window');
            if (trackerWin && trackerWin.style.display !== 'none' && trackerWin.offsetWidth > 0) {
                openWindows.push({ el: trackerWin, close: closeTrackerWindow, z: parseInt(trackerWin.style.zIndex) || 2147483000 });
            }

            const autohuntWin = document.getElementById('piw-autohunt-window');
            if (autohuntWin && autohuntWin.style.display !== 'none' && autohuntWin.offsetWidth > 0) {
                openWindows.push({ el: autohuntWin, close: closeAutoHuntWindow, z: parseInt(autohuntWin.style.zIndex) || 2147483000 });
            }

            // 3. Painel Principal (Hub Central)
            const mainPanel = document.getElementById('piw-panel');
            if (mainPanel && mainPanel.style.display !== 'none' && mainPanel.offsetWidth > 0) {
                openWindows.push({
                    el: mainPanel,
                    close: () => {
                        const closeBtn = document.getElementById('piw-close-panel');
                        if (closeBtn) closeBtn.click();
                        else mainPanel.style.display = 'none';
                    },
                    z: parseInt(mainPanel.style.zIndex) || 2147482000
                });
            }

            if (openWindows.length > 0) {
                // Ordena da mais recentemente aberta/focada (maior z-index) para a primeira
                openWindows.sort((a, b) => b.z - a.z);
                const topWindow = openWindows[0];
                if (topWindow && typeof topWindow.close === 'function') {
                    topWindow.close();
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }
    }, true);

    function makeDraggable(win, handle, storageKey) {
        if (!win || !handle) return;
        let isDragging = false;
        let hasMoved = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        const onStart = (e) => {
            const isReopenBtn = win.id === 'piw-reopen' || handle.id === 'piw-reopen';
            if (!isReopenBtn && e.target.closest('.piw-close, .piw-ah-close, .piw-tw-close, .piw-iw-close, .piw-mw-close, .piw-modal-close, [class*="close"], [id*="close"], [title*="Fechar"], input, button, select, label, .piw-tag-remove')) return;
            isDragging = true;
            hasMoved = false;
            const rect = win.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = rect.left;
            initialTop = rect.top;
            win.style.left = `${initialLeft}px`;
            win.style.top = `${initialTop}px`;
            win.style.right = 'auto';
            win.style.bottom = 'auto';
            win.style.transform = 'none';
            bringToFront(win);
            if (!isReopenBtn) e.preventDefault();
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
            const minVisible = 20;
            const newLeft = Math.max(-win.offsetWidth + minVisible, Math.min(window.innerWidth - minVisible, initialLeft + dx));
            const newTop = Math.max(-10, Math.min(window.innerHeight - minVisible, initialTop + dy));
            win.style.left = `${newLeft}px`;
            win.style.top = `${newTop}px`;
        };

        const onEnd = () => {
            if (isDragging) {
                isDragging = false;
                if (hasMoved) {
                    win._wasDragged = true;
                    setTimeout(() => { win._wasDragged = false; }, 100);
                }
                if (storageKey) {
                    GM_setValue(storageKey, {
                        left: parseFloat(win.style.left),
                        top: parseFloat(win.style.top)
                    });
                }
            }
        };

        handle.addEventListener('mousedown', onStart);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
    }

    function makeResizable(win, resizeHandle, storageKey, minW = 240, minH = 160) {
        if (!win || !resizeHandle) return;
        let isResizing = false;
        let startX = 0, startY = 0;
        let startW = 0, startH = 0;

        const onStart = (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = win.offsetWidth;
            startH = win.offsetHeight;
            bringToFront(win);
            e.preventDefault();
            e.stopPropagation();
        };

        const onMove = (e) => {
            if (!isResizing) return;
            const newW = Math.max(minW, startW + (e.clientX - startX));
            const newH = Math.max(minH, startH + (e.clientY - startY));
            win.style.width = `${newW}px`;
            win.style.height = `${newH}px`;
        };

        const onEnd = () => {
            if (isResizing) {
                isResizing = false;
                if (storageKey) {
                    GM_setValue(storageKey, { w: Math.round(win.offsetWidth), h: Math.round(win.offsetHeight) });
                }
            }
        };

        resizeHandle.addEventListener('mousedown', onStart);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
    }

    let autohuntWindowVisible = GM_getValue('piw_autohunt_win_visible', false);

    function applyOpacityAll(pct) {
        const val = (pct != null ? pct : GM_getValue('piw_opacity', 100)) / 100;
        const panelEl = document.querySelector('.piw-panel');
        const infoWin = document.getElementById('piw-info-window');
        const movesWin = document.getElementById('piw-moves-window');
        const trackerWin = document.getElementById('piw-tracker-window');
        const autohuntWin = document.getElementById('piw-autohunt-window');
        const capturesWin = document.getElementById('piw-captures-window');
        const modalEl = document.querySelector('.piw-modal');
        if (panelEl) panelEl.style.opacity = String(val);
        if (infoWin) infoWin.style.opacity = String(val);
        if (movesWin) movesWin.style.opacity = String(val);
        if (trackerWin) trackerWin.style.opacity = String(val);
        if (autohuntWin) autohuntWin.style.opacity = String(val);
        if (capturesWin) capturesWin.style.opacity = String(val);
        if (modalEl) modalEl.style.opacity = String(val);
    }

    let panel;

    // Detecta se está em cidade
    function isCity() {
        if (!currentSlug) return false;
        return CITY_SLUGS.has(currentSlug);
    }

    function createAutoHuntWindowDOM() {
        if (document.getElementById('piw-autohunt-window')) return;

        const win = document.createElement('div');
        win.id = 'piw-autohunt-window';

        const storedPos = GM_getValue('piw_autohunt_win_pos', { left: 400, top: 200 });
        const storedSize = GM_getValue('piw_autohunt_win_size', null);
        const ahL = parseFloat(storedPos.left);
        const ahT = parseFloat(storedPos.top);
        win.style.left = `${!isNaN(ahL) ? ahL : 400}px`;
        win.style.top = `${!isNaN(ahT) ? ahT : 200}px`;
        if (storedSize && storedSize.w) win.style.width = `${storedSize.w}px`;
        if (storedSize && storedSize.h) win.style.height = `${storedSize.h}px`;
        win.style.display = autohuntWindowVisible ? 'flex' : 'none';

        win.innerHTML = `
            <div class="piw-ah-head">
                <span class="piw-ah-title"><span class="piw-ah-dot" id="piw-ah-dot"></span>🎯 Auto Hunt</span>
                <span class="piw-ah-close" id="piw-ah-close-btn" title="Fechar">✕</span>
            </div>
            <div class="piw-ah-body">
                <div style="display:flex;gap:5px;justify-content:center;margin:2px 0 6px;flex-wrap:wrap">
                    <button class="piw-btn" id="piw-play" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:7px 12px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(34,197,94,.3)" title="Iniciar caça">▶ Play</button>
                    <button class="piw-btn" id="piw-skip" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;padding:7px 11px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(245,158,11,.3)" title="Pular para o próximo pokémon da lista">⏭️ Pular</button>
                    <button class="piw-btn" id="piw-stop" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;padding:7px 12px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(239,68,68,.3)" title="Parar e voltar pra cidade">■ Stop</button>
                    <button class="piw-btn" id="piw-reset" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;padding:7px 10px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(99,102,241,.3)" title="Resetar contadores">↻ Reset</button>
                </div>
                <div style="text-align:center;margin-bottom:6px"><div id="piw-status"></div></div>
                <div class="piw-card">
                    <div class="piw-city" id="piw-city-full" style="display:none">Cidade - auto-switch pausado</div>
                    <div class="piw-leader" id="piw-leader">Líder: —</div>
                    <div class="piw-shiny" id="piw-shiny">✨ Shiny: 0</div>
                    <div class="piw-stat piw-kills" id="piw-kills">Abates: 0 / ${KILL_TARGET}</div>
                    <div class="piw-stat piw-captures" id="piw-captures">Capturas: 0 / ${CAPTURE_TARGET}</div>
                    <div class="piw-dual-progress">
                        <div class="piw-dual-progress-item">
                            <div class="piw-dual-progress-label">Abates</div>
                            <div class="piw-progress"><div class="piw-progress-bar piw-bar-kills" id="piw-bar-kills" style="width:0%"></div></div>
                        </div>
                        <div class="piw-dual-progress-item">
                            <div class="piw-dual-progress-label">Capturas</div>
                            <div class="piw-progress"><div class="piw-progress-bar piw-bar-caps" id="piw-bar-caps" style="width:0%"></div></div>
                        </div>
                    </div>
                    <div class="piw-route" id="piw-route" style="display:none">—</div>
                    <div id="piw-hunting-display" style="text-align:center;margin-top:6px"></div>
                </div>
                <div class="piw-card">
                    <div class="piw-card-label">Opções</div>
                    <label class="piw-check">
                        <input type="checkbox" id="piw-loop" ${loopMode?'checked':''}>
                        Modo loop (não remover da lista)
                    </label>
                    <label class="piw-check">
                        <input type="checkbox" id="piw-exit-kills" ${exitOnKills?'checked':''}>
                        Sair ao atingir abates
                    </label>
                    <label class="piw-check">
                        <input type="checkbox" id="piw-exit-captures" ${exitOnCaptures?'checked':''}>
                        Sair ao atingir capturas
                    </label>
                    <div class="piw-row" style="margin-top:6px">
                        <label class="piw-label" style="flex:1;margin:0">
                            Abates <input type="number" id="piw-target" value="${KILL_TARGET}" min="1" max="99999" style="width:80px">
                        </label>
                        <label class="piw-label" style="flex:1;margin:0">
                            Capturas <input type="number" id="piw-capture-target" value="${CAPTURE_TARGET}" min="1" max="99999" style="width:80px">
                        </label>
                    </div>
                </div>
                <div class="piw-card">
                    <div class="piw-card-label">Pokémon da Lista de Caça</div>
                    <button class="piw-btn piw-btn-primary" id="piw-open-pokedex-ah" style="width:100%;padding:7px 0;font-size:12px;font-weight:700;background:linear-gradient(135deg,#ef4444,#dc2626);border:none;border-radius:10px;cursor:pointer;box-shadow:0 2px 8px rgba(239,68,68,.3)">Selecionar Pokémon</button>
                    <div class="piw-selected-tags" id="piw-selected-tags"></div>
                    <div class="piw-hint" id="piw-hint">Nenhum selecionado</div>
                </div>
            </div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;

        makeBringableToFront(win);
        document.body.appendChild(win);
        applyOpacityAll();

        win.querySelector('#piw-ah-close-btn').addEventListener('click', closeAutoHuntWindow);

        const head = win.querySelector('.piw-ah-head');
        makeDraggable(win, head, 'piw_autohunt_win_pos');

        const resizeHandle = win.querySelector('.piw-win-resize');
        makeResizable(win, resizeHandle, 'piw_autohunt_win_size', 340, 200);

        // Listeners do Auto Hunt
        win.querySelector('#piw-play').addEventListener('click', () => {
            if (!busy && selectedPokemon.length > 0) {
                enabled = true;
                GM_setValue('piw_enabled', true);
                doSwitch();
                syncUI();
            }
        });

        win.querySelector('#piw-skip').addEventListener('click', skipToNextHunt);

        win.querySelector('#piw-stop').addEventListener('click', () => {
            enabled = false;
            GM_setValue('piw_enabled', false);
            huntingPokemon = '';
            GM_setValue('piw_huntingPokemon', '');
            resetObservedMoves();
            syncUI();
            const houseBtn = document.querySelector('button.dock-btn[data-guide="dock-home"], button.dock-btn[data-guide*="home"], button.dock-btn[data-guide*="city"], [class*="dock"] [class*="home"], [class*="dock"] [class*="city"]');
            if (houseBtn) {
                houseBtn.click();
                GM_log('[AutoHunt] Stop: voltando pra cidade');
            } else {
                GM_log('[AutoHunt] Stop: botão da casa não encontrado');
            }
        });

        win.querySelector('#piw-reset').onclick = () => { killCount = 0; captureCount = 0; sessionShinyCount = 0; resetObservedMoves(); syncUI(); };

        win.querySelector('#piw-loop').onchange = function() {
            loopMode = this.checked;
            GM_setValue('piw_loopMode', loopMode);
            syncUI();
        };
        win.querySelector('#piw-exit-kills').onchange = function() {
            exitOnKills = this.checked;
            GM_setValue('piw_exitOnKills', exitOnKills);
            syncUI();
        };
        win.querySelector('#piw-exit-captures').onchange = function() {
            exitOnCaptures = this.checked;
            GM_setValue('piw_exitOnCaptures', exitOnCaptures);
            syncUI();
        };
        win.querySelector('#piw-target').onchange = function() {
            GM_setValue('piw_killTarget', parseInt(this.value) || 100);
            syncUI();
        };
        win.querySelector('#piw-capture-target').onchange = function() {
            GM_setValue('piw_captureTarget', parseInt(this.value) || 1);
            syncUI();
        };
        win.querySelector('#piw-open-pokedex-ah')?.addEventListener('click', () => openPokedexModal());

        renderSelectedTags();
    }

    function closeAutoHuntWindow() {
        autohuntWindowVisible = false;
        GM_setValue('piw_autohunt_win_visible', false);
        const win = document.getElementById('piw-autohunt-window');
        if (win) win.style.display = 'none';
    }

    function toggleAutoHuntWindow() {
        let win = document.getElementById('piw-autohunt-window');
        if (!win) {
            createAutoHuntWindowDOM();
            win = document.getElementById('piw-autohunt-window');
        }
        if (!win) return;

        autohuntWindowVisible = !autohuntWindowVisible;
        GM_setValue('piw_autohunt_win_visible', autohuntWindowVisible);
        win.style.display = autohuntWindowVisible ? 'flex' : 'none';
        if (autohuntWindowVisible) {
            bringToFront(win);
            renderSelectedTags();
            syncUI();
        }
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.className = 'piw-panel';
        makeBringableToFront(panel);
        panel.innerHTML = `
            <h3>
                <span style="display:flex;align-items:center;gap:7px">
                    <svg width="18" height="18" viewBox="0 0 100 100" style="display:inline-block;vertical-align:middle;pointer-events:none"><path d="M 50 10 A 40 40 0 0 1 90 50 L 68 50 A 18 18 0 0 0 32 50 L 10 50 A 40 40 0 0 1 50 10 Z" fill="#ff4d4d"/><path d="M 10 50 L 32 50 A 18 18 0 0 0 68 50 L 90 50 A 40 40 0 0 1 50 90 A 40 40 0 0 1 10 50 Z" fill="#ffffff"/><circle cx="50" cy="50" r="18" fill="#141826"/><circle cx="50" cy="50" r="10" fill="#ffffff"/><circle cx="50" cy="50" r="40" fill="none" stroke="#141826" stroke-width="6"/><line x1="10" y1="50" x2="32" y2="50" stroke="#141826" stroke-width="6"/><line x1="68" y1="50" x2="90" y2="50" stroke="#141826" stroke-width="6"/></svg>
                    <span>Poke Helper</span>
                    <span style="font-size:9.5px;font-weight:700;color:#fff;background:linear-gradient(135deg,#6366f1,#4f46e5);border:1px solid rgba(255,255,255,.22);border-radius:6px;padding:2px 6px;letter-spacing:.3px;box-shadow:0 2px 6px rgba(99,102,241,.35);line-height:1">v${SCRIPT_VERSION}</span>
                </span>
                <span style="display:flex;align-items:center;gap:6px">
                    <span style="display:flex;align-items:center;gap:2px;font-size:11px;color:#9aa3bf">🔍 <input type="range" id="piw-opacity" min="40" max="100" value="${GM_getValue('piw_opacity',100)}" style="width:60px;accent-color:#5b7fff" title="${GM_getValue('piw_opacity',100)}%"></span>
                    <span id="piw-close-panel" class="piw-close" title="Fechar painel">✕</span>
                </span>
            </h3>
            <div class="piw-panel-inner">
                <div class="piw-card" style="margin-bottom:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div id="piw-hub-leader" style="font-size:12px;font-weight:700;color:#fff">👑 Líder: —</div>
                        <div id="piw-hub-status"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#cbd5e1;margin-top:5px">
                        <span>📍 Local: <b id="piw-hub-route" style="color:#a5b4fc">—</b></span>
                        <span>🎯 Alvo: <b id="piw-hub-target" style="color:#4ade80">—</b></span>
                    </div>
                </div>

                <div class="piw-card-label" style="margin-bottom:6px;font-size:11px;font-weight:700;color:#cbd5e1;letter-spacing:.5px">CENTRAL DE FERRAMENTAS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <button class="piw-hub-btn" id="piw-open-autohunt" style="border-top:2px solid #ef4444">
                        <div style="font-size:18px;margin-bottom:2px">🎯</div>
                        <div style="font-weight:700;font-size:12.5px;color:#fff">Auto Hunt</div>
                        <div style="font-size:10.5px;color:#cbd5e1;margin-top:2px;font-weight:500" id="piw-hub-ah-sub">Controle de Caça</div>
                    </button>

                    <button class="piw-hub-btn" id="piw-open-analyzer" style="border-top:2px solid #10b981">
                        <div style="font-size:18px;margin-bottom:2px">⏱️</div>
                        <div style="font-weight:700;font-size:12.5px;color:#fff">Hunt Analyzer</div>
                        <div style="font-size:10.5px;color:#cbd5e1;margin-top:2px;font-weight:500">XP, Loot & Histórico</div>
                    </button>

                    <button class="piw-hub-btn" id="piw-open-ivs" style="border-top:2px solid #8b5cf6">
                        <div style="font-size:18px;margin-bottom:2px">📊</div>
                        <div style="font-weight:700;font-size:12.5px;color:#fff">IVs & Stats</div>
                        <div style="font-size:10.5px;color:#cbd5e1;margin-top:2px;font-weight:500">Status do Pokémon</div>
                    </button>

                    <button class="piw-hub-btn" id="piw-open-moves" style="border-top:2px solid #06b6d4">
                        <div style="font-size:18px;margin-bottom:2px">⚔️</div>
                        <div style="font-weight:700;font-size:12.5px;color:#fff">Moves</div>
                        <div style="font-size:10.5px;color:#cbd5e1;margin-top:2px;font-weight:500">Ataques do time</div>
                    </button>

                    <button class="piw-hub-btn" id="piw-open-captures" style="border-top:2px solid #f59e0b;grid-column:span 2;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:10px;padding:8px">
                        <div style="font-size:18px">📦</div>
                        <div style="text-align:left">
                            <div style="font-weight:700;font-size:12.5px;color:#fff">Log de Capturas</div>
                            <div style="font-size:10.5px;color:#cbd5e1;margin-top:1px;font-weight:500" id="piw-hub-caps-sub">Histórico de Pokémon</div>
                        </div>
                    </button>
                </div>
            </div>
        `;

        const opacitySlider = panel.querySelector('#piw-opacity');
        if (opacitySlider) {
            applyOpacityAll(opacitySlider.value);
            opacitySlider.addEventListener('input', () => {
                const opacityVal = parseInt(opacitySlider.value) || 100;
                opacitySlider.title = opacityVal + '%';
                GM_setValue('piw_opacity', opacityVal);
                applyOpacityAll(opacityVal);
            });
        }

        // Fechar/reabrir painel com persistência e botão arrastável
        const closeBtn = panel.querySelector('#piw-close-panel');
        const reopenBtn = document.createElement('button');
        reopenBtn.id = 'piw-reopen';
        reopenBtn.style.visibility = 'hidden';
        reopenBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 100 100" style="display:block; pointer-events:none;">
          <path d="M 50 10 A 40 40 0 0 1 90 50 L 68 50 A 18 18 0 0 0 32 50 L 10 50 A 40 40 0 0 1 50 10 Z" fill="#ff4d4d"/>
          <path d="M 10 50 L 32 50 A 18 18 0 0 0 68 50 L 90 50 A 40 40 0 0 1 50 90 A 40 40 0 0 1 10 50 Z" fill="#ffffff"/>
          <circle cx="50" cy="50" r="18" fill="#141826"/>
          <circle cx="50" cy="50" r="10" fill="#ffffff"/>
          <circle cx="50" cy="50" r="40" fill="none" stroke="#141826" stroke-width="6"/>
          <line x1="10" y1="50" x2="32" y2="50" stroke="#141826" stroke-width="6"/>
          <line x1="68" y1="50" x2="90" y2="50" stroke="#141826" stroke-width="6"/>
        </svg>`;
        reopenBtn.title = 'Poke Helper';

        const attached = attachReopenBtnToDock();
        if (!attached) {
            document.body.appendChild(reopenBtn);
            const savedReopenPos = GM_getValue('piw_reopenPos', null);
            if (savedReopenPos && !isNaN(parseFloat(savedReopenPos.left)) && !isNaN(parseFloat(savedReopenPos.top))) {
                reopenBtn.style.left = parseFloat(savedReopenPos.left) + 'px';
                reopenBtn.style.top = parseFloat(savedReopenPos.top) + 'px';
                reopenBtn.style.right = 'auto';
                reopenBtn.style.bottom = 'auto';
            } else {
                reopenBtn.style.top = '10px';
                reopenBtn.style.right = '10px';
                reopenBtn.style.bottom = 'auto';
                reopenBtn.style.left = 'auto';
            }
            makeDraggable(reopenBtn, reopenBtn, 'piw_reopenPos');
        }
        attachReopenBtnToDock();

        let panelClosed = GM_getValue('piw_panelClosed', false);
        if (panelClosed) {
            panel.style.display = 'none';
        } else {
            panel.style.display = 'flex';
        }

        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
            GM_setValue('piw_panelClosed', true);
        });

        reopenBtn.addEventListener('click', () => {
            if (reopenBtn._wasDragged) return;
            if (panel.style.display === 'none') {
                panel.style.display = 'flex';
                GM_setValue('piw_panelClosed', false);
                bringToFront(panel);
            } else {
                panel.style.display = 'none';
                GM_setValue('piw_panelClosed', true);
            }
        });

        // Hub button listeners
        panel.querySelector('#piw-open-autohunt').addEventListener('click', toggleAutoHuntWindow);
        panel.querySelector('#piw-open-analyzer').addEventListener('click', toggleTrackerWindow);
        panel.querySelector('#piw-open-ivs').addEventListener('click', toggleInfoWindow);
        panel.querySelector('#piw-open-moves').addEventListener('click', toggleMovesWindow);
        panel.querySelector('#piw-open-captures').addEventListener('click', toggleCapturesWindow);

        document.body.appendChild(panel);

        const savedPos = GM_getValue('piw_panelPos', null);
        if (savedPos) {
            const pl = parseFloat(savedPos.left);
            const pt = parseFloat(savedPos.top);
            const maxLeft = Math.max(10, (window.innerWidth || 1200) - 340);
            const maxTop = Math.max(10, (window.innerHeight || 800) - 200);
            if (!isNaN(pl) && pl >= 0 && pl <= maxLeft) {
                panel.style.left = pl + 'px';
                panel.style.right = 'auto';
            }
            if (!isNaN(pt) && pt >= 0 && pt <= maxTop) {
                panel.style.top = pt + 'px';
                panel.style.bottom = 'auto';
            }
        }

        const title = panel.querySelector('h3');
        makeDraggable(panel, title, 'piw_panelPos');

        createAutoHuntWindowDOM();
    }

    function syncUI() {
        // Atualiza leaderLevel com o mesmo fallback da janela de IVs:
        // 1) currentLeaderData (WebSocket), 2) getLeaderLevelFromDOM() (DOM do jogo)
        if (leaderName) {
            const domLv = getLeaderLevelFromDOM();
            if (domLv !== null && domLv > 0) {
                if (domLv !== leaderLevel) {
                    leaderLevel = domLv;
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        try { socket.send(JSON.stringify({ type: 'pokes-get' })); } catch(e){}
                    }
                }
            } else if (!leaderLevel && currentLeaderData) {
                leaderLevel = currentLeaderData.level || currentLeaderData.lvl || currentLeaderData.pokemonLevel || 0;
            }
        }

        const target = GM_getValue('piw_killTarget', 100);
        const capTarget = GM_getValue('piw_captureTarget', 1);

        // Atualização do Hub Principal
        const hubLeader = document.getElementById('piw-hub-leader');
        const hubStatus = document.getElementById('piw-hub-status');
        const hubRoute = document.getElementById('piw-hub-route');
        const hubTarget = document.getElementById('piw-hub-target');
        const hubAhSub = document.getElementById('piw-hub-ah-sub');
        const hubCapsSub = document.getElementById('piw-hub-caps-sub');

        if (hubLeader) hubLeader.textContent = `👑 Líder: ${leaderName ? `${leaderName} (Lv. ${leaderLevel || '?'})` : '—'}`;
        if (hubStatus) {
            hubStatus.innerHTML = enabled
                ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(34,197,94,.2);color:#34d399">▶ Rodando</span>`
                : `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(239,68,68,.2);color:#f87171">⏸ Pausado</span>`;
        }
        if (hubRoute) hubRoute.textContent = currentRoute || '—';
        if (hubTarget) hubTarget.textContent = huntingPokemon || (selectedPokemon.length > 0 ? selectedPokemon[0] : 'Nenhum');
        if (hubAhSub) hubAhSub.textContent = `${enabled ? '▶ Caçando' : '⏸ Pausado'} · ${selectedPokemon.length} alvo(s)`;
        if (hubCapsSub) {
            const totalC = captureLogs ? captureLogs.length : 0;
            const shinyC = captureLogs ? captureLogs.filter(p => p.shiny).length : 0;
            hubCapsSub.textContent = `${totalC} capturado(s)${shinyC > 0 ? ` · ${shinyC} ✨ Shiny` : ''}`;
        }

        const killsEl = document.getElementById('piw-kills');
        const capsEl = document.getElementById('piw-captures');
        const barKills = document.getElementById('piw-bar-kills');
        const barCaps = document.getElementById('piw-bar-caps');
        const re = document.getElementById('piw-route');
        const st = document.getElementById('piw-status');
        const cityEl = document.getElementById('piw-city-full');
        const leaderEl = document.getElementById('piw-leader');
        const shinyEl = document.getElementById('piw-shiny');

        if (killsEl) killsEl.textContent = `Abates: ${killCount} / ${target}`;
        if (capsEl) capsEl.textContent = `Capturas: ${captureCount} / ${capTarget}`;
        if (barKills) barKills.style.width = Math.min(100, killCount/target*100) + '%';
        if (barCaps) barCaps.style.width = Math.min(100, captureCount/capTarget*100) + '%';
        if (re)  re.textContent  = currentRoute || '—';
        if (st) {
            st.innerHTML = enabled
                ? '<span class="piw-badge piw-badge-running">● Rodando</span>'
                : '<span class="piw-badge piw-badge-paused">○ Pausado</span>';
        }
        if (cityEl) {
            const inCity = isCity();
            cityEl.style.display = inCity ? 'block' : 'none';
        }
        if (leaderEl) {
            if (leaderName) {
                const imgUrl = getPokemonImageUrl(leaderPokeId, leaderName, true);
                const fallbackUrl = getPokemonImageUrl(leaderPokeId, leaderName, false);
                const typeBadges = leaderTypes.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS_MAP[t.toLowerCase()]||TYPE_COLORS[t]||'#555'};font-size:9px;padding:1px 6px">${getTypeLabelPT(t)}</span>`).join(' ');
                leaderEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:10px">${imgUrl ? `<div style="width:52px;height:52px;border:2px solid #3d4a6a;border-radius:10px;background:#131720;display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${imgUrl}" style="width:44px;height:44px;image-rendering:pixelated" onerror="this.onerror=null;this.src='${fallbackUrl}'"></div>` : ''}<div style="text-align:left"><div style="display:flex;align-items:baseline;gap:5px"><span style="color:#e0e4ef;font-weight:700;font-size:15px">${leaderName}</span><span style="color:#93a0e8;font-weight:600;font-size:12px;margin-left:2px">Lv. ${leaderLevel || '?'}</span></div><div style="display:flex;gap:4px;margin-top:3px">${typeBadges}</div></div></div>`;
            } else {
                leaderEl.textContent = '—';
            }
        }
        if (shinyEl) {
            shinyEl.textContent = `✨ Shiny: ${sessionShinyCount}`;
        }
        const huntEl = document.getElementById('piw-hunting-display');
        const huntHTML = (huntingPokemon && selectedPokemon.length > 0 && !isCity()) ? (() => {
            const creature = creatures.find(c => c.name?.toLowerCase() === huntingPokemon.toLowerCase());
            const types = [creature?.type1, creature?.type2].filter(Boolean);
            const typeBadges = types.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS_MAP[t.toLowerCase()]||TYPE_COLORS[t]||'#555'};font-size:9px;padding:1px 6px">${getTypeLabelPT(t)}</span>`).join(' ');
            return `<div style="display:flex;align-items:center;justify-content:center;gap:8px"><span style="color:#e0e4ef;font-weight:700;font-size:15px">${huntingPokemon}</span><span style="display:flex;gap:4px">${typeBadges}</span></div>`;
        })() : '';
        if (huntEl) huntEl.innerHTML = huntHTML;
        if (infoWindowVisible) renderInfoWindow();
        saveState();
        renderInfoWindow();
        renderMovesWindow();
    }

    function createInfoWindowDOM() {
        if (document.getElementById('piw-info-window')) return;

        const win = document.createElement('div');
        win.id = 'piw-info-window';

        const storedPos = GM_getValue('piw_info_win_pos', { left: 400, top: 120 });
        const storedSize = GM_getValue('piw_info_win_size', null);
        const iwL = parseFloat(storedPos.left);
        const iwT = parseFloat(storedPos.top);
        win.style.left = `${!isNaN(iwL) ? iwL : 400}px`;
        win.style.top = `${!isNaN(iwT) ? iwT : 120}px`;
        if (storedSize && storedSize.w) win.style.width = `${storedSize.w}px`;
        if (storedSize && storedSize.h) win.style.height = `${storedSize.h}px`;
        win.style.display = infoWindowVisible ? 'flex' : 'none';

        win.innerHTML = `
            <div class="piw-iw-head">
                <span class="piw-iw-title"><span class="piw-iw-dot"></span>Pokémon IVs & Stats</span>
                <span class="piw-iw-close" id="piw-iw-close-btn" title="Fechar">✕</span>
            </div>
            <div class="piw-iw-body"></div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;

        makeBringableToFront(win);
        document.body.appendChild(win);
        applyOpacityAll();

        win.querySelector('#piw-iw-close-btn').addEventListener('click', closeInfoWindow);

        const head = win.querySelector('.piw-iw-head');
        makeDraggable(win, head, 'piw_info_win_pos');

        const resizeHandle = win.querySelector('.piw-win-resize');
        makeResizable(win, resizeHandle, 'piw_info_win_size', 340, 200);

        const handleSlotSelect = (e) => {
            const slot = e.target.closest('.piw-iw-party-slot');
            if (!slot) return;
            e.preventDefault();
            e.stopPropagation();
            const id = slot.dataset.id;
            const idx = parseInt(slot.dataset.idx, 10);
            let selected = null;
            if (currentPartyList && currentPartyList.length > 0) {
                if (id) selected = currentPartyList.find(p => String(p.id) === String(id));
                if (!selected && !isNaN(idx)) selected = currentPartyList[idx];
            }
            if (selected) {
                const isLeaderMon = selected.leader || (currentLeaderData && selected.id === currentLeaderData.id);
                if (isLeaderMon) {
                    inspectedPokemon = null;
                    isPartySlotPinned = false;
                } else {
                    inspectedPokemon = selected;
                    isPartySlotPinned = true;
                }
                renderInfoWindow();
            }
        };

        win.addEventListener('pointerdown', handleSlotSelect);
        win.addEventListener('click', handleSlotSelect);
    }

    function closeInfoWindow() {
        infoWindowVisible = false;
        GM_setValue('piw_info_win_visible', false);
        inspectedPokemon = null;
        isPartySlotPinned = false;
        const win = document.getElementById('piw-info-window');
        if (win) win.style.display = 'none';
        if (capturesWindowVisible) renderCapturesWindow();
    }

    function toggleInfoWindow() {
        let win = document.getElementById('piw-info-window');
        if (!win) {
            createInfoWindowDOM();
            win = document.getElementById('piw-info-window');
        }
        if (!win) return;

        infoWindowVisible = !infoWindowVisible;
        GM_setValue('piw_info_win_visible', infoWindowVisible);
        win.style.display = infoWindowVisible ? 'flex' : 'none';
        if (infoWindowVisible) {
            bringToFront(win);
            if (socket && socket.readyState === WebSocket.OPEN) {
                try { socket.send(JSON.stringify({ type: 'pokes-get' })); } catch(e){}
            }
            renderInfoWindow();
        } else {
            inspectedPokemon = null;
            isPartySlotPinned = false;
            if (capturesWindowVisible) renderCapturesWindow();
        }
    }

    function renderInfoWindow() {
        const win = document.getElementById('piw-info-window');
        if (!win || !infoWindowVisible) return;

        const body = win.querySelector('.piw-iw-body');
        if (!body) return;

        const domLeader = getLeaderFromDOM();
        if (domLeader && domLeader.name.toLowerCase() !== leaderName.toLowerCase()) {
            leaderName = domLeader.name;
            leaderLevel = domLeader.level;
            const c = creatures.find(cr => cr.name?.toLowerCase() === domLeader.name.toLowerCase());
            if (c) {
                leaderPokeId = c.pokeId || c.id || 0;
                leaderTypes = [c.type1, c.type2].filter(Boolean);
                if (currentLeaderData) {
                    currentLeaderData.name = c.name;
                    currentLeaderData.speciesId = c.pokeId || c.id;
                    currentLeaderData.pokeId = c.pokeId || c.id;
                    currentLeaderData.type1 = c.type1;
                    currentLeaderData.type2 = c.type2;
                    currentLeaderData.level = domLeader.level;
                }
            }
        }

        let leader = inspectedPokemon || currentLeaderData;
        if (!leader && leaderName) {
            const c = creatures.find(c => c.name?.toLowerCase() === leaderName.toLowerCase());
            if (c) {
                leader = {
                    name: c.name,
                    speciesId: c.pokeId || c.id,
                    level: leaderLevel || 1,
                    type1: c.type1,
                    type2: c.type2
                };
            }
        }
        if (!leader) {
            if (domLeader) {
                leaderName = domLeader.name;
                leaderLevel = domLeader.level;
                const c = creatures.find(c => c.name?.toLowerCase() === domLeader.name.toLowerCase());
                if (c) {
                    leader = {
                        name: c.name,
                        speciesId: c.pokeId || c.id,
                        level: domLeader.level,
                        type1: c.type1,
                        type2: c.type2
                    };
                } else {
                    leader = {
                        name: domLeader.name,
                        level: domLeader.level
                    };
                }
            }
        }

        if (!leader) {
            body.innerHTML = '<div style="color:#aab3d6;padding:12px;text-align:center">Aguardando dados do pokémon líder…</div>';
            return;
        }

        if (leader && leader.id && allPokesList && allPokesList.length > 0) {
            const liveMatch = allPokesList.find(p => String(p.id) === String(leader.id) || String(p._id) === String(leader.id));
            if (liveMatch) {
                leader = { ...liveMatch, ...leader };
                if (liveMatch.stats) leader.stats = { ...liveMatch.stats, ...(leader.stats || {}) };
                if (liveMatch.power != null) leader.power = liveMatch.power;
                if (liveMatch.maxHp != null) leader.maxHp = liveMatch.maxHp;
                if (liveMatch.hp != null) leader.hp = liveMatch.hp;
            }
        }

        const isInspectingNonLeader = Boolean(inspectedPokemon && (!currentLeaderData || inspectedPokemon !== currentLeaderData || inspectedPokemon.id !== currentLeaderData.id));
        const displayName = cleanPokemonName(leader?.name || leaderName || '?');
        const level = isInspectingNonLeader ? (leader.level || 1) : (leaderLevel || leader?.level || 1);
        const resolved = resolvePokemonSpecies(displayName, leader.speciesId || leader.pokeId || leaderPokeId);
        const currentCreature = resolved.creature;
        const speciesId = resolved.speciesId;

        const types = Array.from(new Set([leader.type1, leader.type2, currentCreature?.type1, currentCreature?.type2].filter(Boolean)));
        if (types.length === 0 && !isInspectingNonLeader && leaderTypes.length > 0) types.push(...leaderTypes);

        const isShiny = Boolean(leader.shiny);
        const sprites = getPokemonSpriteUrls(speciesId, isShiny);

        const ivTotal = leader.ivTotal ?? '?';
        const quality = leader.quality;
        const qTier = getQualityTier(quality);

        let calculatedExpPct = null;
        if (leader.expPct != null) {
            calculatedExpPct = Number(leader.expPct);
        } else if (leader.exp != null && (leader.maxExp != null || leader.expNext != null || leader.expNeeded != null)) {
            const maxE = leader.maxExp || leader.expNext || leader.expNeeded;
            if (maxE > 0) calculatedExpPct = (Number(leader.exp) / Number(maxE)) * 100;
        }

        const baseStats = getBaseStatsForSpecies(speciesId);
        const levelForIV = leader.level || level || 1;
        const avgIV = (Number.isFinite(Number(leader.ivTotal)) && Number(leader.ivTotal) > 0) ? Math.round(Number(leader.ivTotal) / 6) : 15;
        const monQual = leader.quality || 1;

        let statsObj = leader.stats || {};
        if ((!statsObj || Object.keys(statsObj).length === 0) && baseStats) {
            const monLvl = levelForIV;
            statsObj = {
                hp: leader.hp != null && leader.hp < 10 ? leader.hp : calculateStatFormula(baseStats.hp, avgIV, monLvl, Math.pow(monQual, QUALITY_EXP.hp)),
                atk: leader.atk ?? calculateStatFormula(baseStats.atk, avgIV, monLvl, Math.pow(monQual, QUALITY_EXP.atk)),
                def: leader.def ?? calculateStatFormula(baseStats.def, avgIV, monLvl, Math.pow(monQual, QUALITY_EXP.def)),
                spAtk: leader.spAtk ?? leader.spatk ?? calculateStatFormula(baseStats.spAtk, avgIV, monLvl, Math.pow(monQual, QUALITY_EXP.spAtk)),
                spDef: leader.spDef ?? leader.spdef ?? calculateStatFormula(baseStats.spDef, avgIV, monLvl, Math.pow(monQual, QUALITY_EXP.spDef)),
                speed: leader.speed ?? leader.spe ?? calculateStatFormula(baseStats.speed, avgIV, monLvl, Math.pow(monQual, QUALITY_EXP.speed))
            };
        }

        let calculatedPower = leader.power;
        if (!calculatedPower || calculatedPower === '?') {
            if (statsObj && Object.keys(statsObj).length > 0) {
                const sum = (Number(statsObj.hp) || 0) + (Number(statsObj.atk) || 0) + (Number(statsObj.def) || 0) + (Number(statsObj.spAtk) || 0) + (Number(statsObj.spDef) || 0) + (Number(statsObj.speed) || 0);
                calculatedPower = sum;
            }
        }
        const power = calculatedPower ?? '?';
        const sellVal = leader.sellValue ?? '?';

        const slotIdx = currentPartyList ? currentPartyList.findIndex(p => p.id === leader.id) : -1;
        const domData = (!isInspectingNonLeader && slotIdx >= 0) ? getPartyMonStatsFromDOM(slotIdx, leader.name) : null;
        const calcMaxHp = baseStats ? calculateMaxHpFormula(baseStats.hp, avgIV, levelForIV, Math.pow(monQual, QUALITY_EXP.hp)) : 24;
        const hpMax = isInspectingNonLeader ? (leader.maxHp ?? calcMaxHp) : (leader.maxHp ?? domData?.hpMax ?? calcMaxHp);
        const hpCurrent = isInspectingNonLeader ? (leader.hp ?? hpMax) : (leader.hp ?? domData?.hpCurrent ?? hpMax);
        const expPct = isInspectingNonLeader ? (leader.expPct ?? null) : (calculatedExpPct ?? domData?.expPct ?? leader.expPct ?? null);

        const calculatedIVs = computeExactIVs({ ...leader, stats: statsObj, speciesId, level: levelForIV });

        let partyBarHtml = '';
        if (currentPartyList && currentPartyList.length > 0) {
            partyBarHtml = `
                <div class="piw-iw-party-bar" title="Passe o mouse ou clique para ver os dados de outro Pokémon da equipe">
                    ${currentPartyList.map((p, idx) => {
                        const pName = cleanPokemonName(p.name);
                        const pSpecies = p.speciesId || p.pokeId || (() => {
                            const c = creatures.find(cr => cr.name?.toLowerCase() === pName.toLowerCase());
                            return c?.pokeId || 0;
                        })();
                        const isLeaderMon = p.leader || (currentLeaderData && p.id === currentLeaderData.id);
                        const isSelectedMon = inspectedPokemon ? (p.id === inspectedPokemon.id) : isLeaderMon;
                        const iconUrl = getPokemonImageUrl(pSpecies, pName);
                        return `
                            <div class="piw-iw-party-slot${isLeaderMon ? ' leader' : ''}${isSelectedMon ? ' inspected' : ''}" data-idx="${idx}" data-id="${p.id || ''}" title="${pName} (Nv. ${p.level || '?'})${isLeaderMon ? ' - Líder Ativo' : ''}">
                                ${isLeaderMon ? '<span class="piw-slot-leader">⭐</span>' : ''}
                                <img src="${iconUrl}" onerror="this.style.display='none'">
                                <span class="piw-slot-lv">${p.level || ''}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        let qualityChipHtml = `<span class="piw-iw-chip">Qualidade <b>${quality ?? '?'}</b></span>`;
        if (qTier && quality) {
            if (isShiny) {
                qualityChipHtml = `<span class="piw-iw-chip" style="color:#fff;background:linear-gradient(120deg, ${qTier.color}40, ${qTier.color}cc, ${qTier.color}40);border-color:${qTier.color}"><b>${qTier.name}</b> (${quality})</span>`;
            } else {
                qualityChipHtml = `<span class="piw-iw-chip" style="color:${qTier.color};background:${qTier.color}22;border-color:${qTier.color}99;font-weight:700" title="${qTier.name}"><b>${qTier.name}</b> (${quality})</span>`;
            }
        }

        const heroHtml = `
            <div class="piw-iw-hero">
                ${sprites ? `<img class="piw-iw-sprite" src="${sprites.anim}" onerror="this.onerror=null;this.src='${sprites.still}'">` : ''}
                <div style="min-width:0">
                    <div class="piw-iw-name">${displayName}${isShiny ? ' <span style="color:#ffd54a">✨</span>' : ''}<span class="piw-iw-lv">Lv. ${level}</span></div>
                    <div class="piw-iw-types">
                        ${types.map(t => {
                            const bg = TYPE_COLORS_MAP[t.toLowerCase()] || TYPE_COLORS[t.toUpperCase()] || '#888';
                            const pt = TYPE_PT_MAP[t.toLowerCase()] || t;
                            return `<span class="piw-iw-type" style="background:${bg}">${pt}</span>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            <div class="piw-iw-chips">
                <span class="piw-iw-chip piw-iw-chip-accent">IV total <b>${ivTotal}</b></span>
                ${qualityChipHtml}
                <span class="piw-iw-chip">⚡ ${power}</span>
                ${sellVal !== '?' ? `<span class="piw-iw-chip">💰 ${sellVal}</span>` : ''}
                ${getClanForPokemon(types, GM_getValue('piw_myClan', ''))}
            </div>
        `;

        let hpPct = 0;
        if (Number.isFinite(Number(hpCurrent)) && Number.isFinite(Number(hpMax)) && Number(hpMax) > 0) {
            hpPct = Math.max(0, Math.min(100, (Number(hpCurrent) / Number(hpMax)) * 100));
        }
        const hpColor = hpPct > 50 ? '#7ac74c' : hpPct > 20 ? '#facc15' : '#f87171';

        const barsHtml = `
            <div class="piw-iw-bar-row">
                <span class="piw-iw-bar-tag">HP</span>
                <div class="piw-iw-bar">
                    <div class="piw-iw-bar-fill" style="width:${hpPct.toFixed(1)}%;background:linear-gradient(90deg, ${hpColor}cc, ${hpColor})"></div>
                </div>
                <span class="piw-iw-bar-val">${hpCurrent}/${hpMax}</span>
            </div>
            ${expPct !== null ? `
            <div class="piw-iw-bar-row">
                <span class="piw-iw-bar-tag">EXP</span>
                <div class="piw-iw-bar">
                    <div class="piw-iw-bar-fill" style="width:${Math.max(0, Math.min(100, expPct)).toFixed(1)}%;background:linear-gradient(90deg, #818cf8cc, #818cf8)"></div>
                </div>
                <span class="piw-iw-bar-val">${Number(expPct).toFixed(1)}%</span>
            </div>` : ''}
        `;
        const statsGridHtml = `
            <div class="piw-iw-card">
                <div class="piw-iw-sec">• STATS</div>
                <div class="piw-iw-stats">
                    ${STAT_KEYS.map(k => {
                        const val = statsObj[k] ?? '?';
                        const baseVal = baseStats ? baseStats[k] : '?';
                        const c = STAT_COLORS[k];
                        const label = STAT_LABELS[k];
                        return `
                            <div class="piw-iw-stat" style="--c:${c}">
                                <div class="piw-iw-stat-name">${label}</div>
                                <div class="piw-iw-stat-val">${val}</div>
                                <div class="piw-iw-stat-base">base <b>${baseVal}</b></div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        const effHtml = calculateMatchupsHtml(types);
        const effSectionHtml = effHtml ? `
            <div class="piw-iw-card">
                <div class="piw-iw-sec">• EFETIVIDADE</div>
                ${effHtml}
            </div>
        ` : '';

        let ivsSectionHtml = '';
        if (calculatedIVs) {
            let ivSumMin = 0, ivSumMax = 0;
            const ivRows = STAT_KEYS.map(k => {
                const range = calculatedIVs[k];
                ivSumMin += range.min;
                ivSumMax += range.max;
                const rangeTxt = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
                const pct = Math.max(0, Math.min(100, (range.max / 32) * 100));
                const c = STAT_COLORS[k];
                const label = STAT_LABELS[k];
                return `
                    <div class="piw-iw-iv-row">
                        <span class="piw-iw-iv-name" style="color:${c}">${label}</span>
                        <div class="piw-iw-bar">
                            <div class="piw-iw-bar-fill" style="width:${pct.toFixed(1)}%;background:linear-gradient(90deg, ${c}cc, ${c})"></div>
                        </div>
                        <span class="piw-iw-iv-val" style="color:${c}">${rangeTxt}</span>
                    </div>
                `;
            }).join('');

            const exactMatchesTotal = ivSumMin === ivSumMax && Number.isFinite(Number(ivTotal)) && ivSumMin === Number(ivTotal);
            const sumNote = ivSumMin === ivSumMax
                ? `<div class="piw-iw-sum" style="color:${exactMatchesTotal ? '#9fe08a' : '#ffb04a'}">Σ IVs = ${ivSumMin}${exactMatchesTotal ? ' ✓ confere com o IV total' : ''}</div>`
                : `<div class="piw-iw-sum" style="color:#aab3d6">Intervalos fecham com o ganho de níveis.</div>`;

            ivsSectionHtml = `
                <div class="piw-iw-card">
                    <div class="piw-iw-sec">• IVS POR STAT <small>· exatos, fórmula do jogo</small></div>
                    ${ivRows}
                    ${sumNote}
                </div>
            `;
        }

        let inspectingBannerHtml = '';
        if (isInspectingNonLeader) {
            inspectingBannerHtml = `
                <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.35);padding:6px 10px;border-radius:8px;margin-bottom:8px;font-size:11.5px;color:#fde047;font-weight:700">
                    <span>📦 Pokémon Inspecionado</span>
                    <span id="piw-iw-return-leader-btn" style="cursor:pointer;color:#fff;background:rgba(255,255,255,.12);padding:2px 8px;border-radius:5px;font-size:11px;transition:all .15s">Voltar ao Líder ✕</span>
                </div>
            `;
        }

        body.innerHTML = `
            ${inspectingBannerHtml}
            ${partyBarHtml}
            <div class="piw-iw-card">
                ${heroHtml}
                ${barsHtml}
            </div>
            ${statsGridHtml}
            ${effSectionHtml}
            ${ivsSectionHtml}
        `;

        body.querySelector('#piw-iw-return-leader-btn')?.addEventListener('click', () => {
            inspectedPokemon = null;
            isPartySlotPinned = false;
            renderInfoWindow();
            if (capturesWindowVisible) renderCapturesWindow();
        });
    }

    // ========== JANELA DE MOVES ==========
    let movesWindowVisible = GM_getValue('piw_moves_win_visible', false);
    let inspectedMovesPokemon = null;
    let observedMovesMap = new Map();
    let currentActiveMove = null;

    const MOVE_CLASSES = {
        physical: { label: "Físico", short: "🗡", color: "#f97316" },
        special: { label: "Especial", short: "🌀", color: "#38bdf8" },
        status: { label: "Status", short: "💫", color: "#a1a1aa" }
    };

    function getMoveClassBadge(category) {
        const catKey = String(category || "").toLowerCase();
        const cls = MOVE_CLASSES[catKey];
        if (!cls) return "";
        return `<span class="piw-mw-move-cls" title="${cls.label}" style="color:${cls.color};background:${cls.color}22;border-color:${cls.color}66">${cls.short} ${cls.label}</span>`;
    }

    function extractPokemonMoves(leaderObj, creatureObj) {
        const getList = (item) => {
            if (typeof item === 'string') return { name: item };
            if (!item || typeof item !== 'object') return null;
            const name = item.name || item.moveName || item.move || item.id;
            if (!name) return null;
            return {
                name: String(name),
                power: item.power ?? item.basePower ?? item.damage ?? item.dmg ?? null,
                type: item.type != null ? String(item.type) : (item.element != null ? String(item.element) : null),
                cooldown: item.cooldownMs ?? item.cooldown ?? item.cd ?? null,
                category: item.category ?? item.damageClass ?? item.kind ?? null,
                learnLevel: item.learnLevel ?? item.level ?? item.levelLearned ?? null
            };
        };

        const sources = [
            leaderObj?.moves, leaderObj?.attacks, leaderObj?.skills, leaderObj?.spells,
            creatureObj?.moves, creatureObj?.attacks, creatureObj?.skills, creatureObj?.spells
        ];

        for (const src of sources) {
            if (Array.isArray(src) && src.length > 0) {
                const list = src.map(getList).filter(Boolean);
                if (list.length > 0) return list;
            }
        }
        return [];
    }

    function isLeaderKnownMove(moveName) {
        if (!moveName) return false;
        const nameLower = moveName.trim().toLowerCase();
        if (currentLeaderData) {
            if (Array.isArray(currentLeaderData.moves)) {
                if (currentLeaderData.moves.some(m => (typeof m === 'string' ? m : m?.name)?.toLowerCase() === nameLower)) return true;
            }
            if (Array.isArray(currentLeaderData.attacks)) {
                if (currentLeaderData.attacks.some(m => (typeof m === 'string' ? m : m?.name)?.toLowerCase() === nameLower)) return true;
            }
            if (Array.isArray(currentLeaderData.skills)) {
                if (currentLeaderData.skills.some(m => (typeof m === 'string' ? m : m?.name)?.toLowerCase() === nameLower)) return true;
            }
        }
        if (leaderName && creatures && creatures.length > 0) {
            const c = creatures.find(cr => cr.name?.toLowerCase() === leaderName.toLowerCase());
            if (c) {
                const cMoves = extractPokemonMoves(null, c);
                if (cMoves && cMoves.some(m => m.name && m.name.toLowerCase() === nameLower)) return true;
            }
        }
        return false;
    }

    function extractCombatHit(data, depth = 0, parentKey = '') {
        if (!data || typeof data !== 'object' || depth > 5) return null;

        // Se o objeto ou contexto indicar que é ataque disparado pelo jogador / contra o inimigo:
        const isOutgoing = (
            data.target === 'enemy' || data.target === 'wild' || data.target === 'mob' || data.target === 'opponent' ||
            data.source === 'player' || data.from === 'player' || data.attacker === 'player' ||
            data.sourceTeam === 'player' || data.targetTeam === 'enemy' ||
            data.isEnemyTarget === true || data.toEnemy === true || data.outgoing === true ||
            (data.isPlayer === true && !data.isPlayerTarget) ||
            /dealt|outgoing|toEnemy|enemyDamage|hitEnemy/i.test(parentKey)
        );

        if (isOutgoing) return null;

        const moveName = data.moveName || data.attackName || data.spellName || (typeof data.move === 'string' ? data.move : data.move?.name) || data.attack;
        const dmg = Number(data.damage ?? data.dmg ?? data.dano ?? data.amount);

        if (typeof moveName === 'string' && moveName.trim() && Number.isFinite(dmg)) {
            const cleanName = moveName.trim();

            const isExplicitlyTaken = Boolean(
                data.taken || data.received || data.incoming || data.isPlayerTarget ||
                data.target === 'player' || data.targetTeam === 'player' || data.to === 'player' ||
                /taken|received|incoming|playerDamage|hitPlayer/i.test(parentKey)
            );

            if (!isExplicitlyTaken && isLeaderKnownMove(cleanName)) {
                return null; // É o próprio jogador atacando o oponente
            }

            return {
                name: cleanName,
                dmg: dmg,
                type: typeof data.type === 'string' && data.type !== 'battle' && data.type !== 'hit' ? data.type : null,
                eff: Number.isFinite(Number(data.eff)) ? Number(data.eff) : null,
                taken: true
            };
        }

        for (const [key, val] of Object.entries(data)) {
            if (typeof val === 'object' && val !== null) {
                if (/dealt|outgoing|enemyDamage|toEnemy|playerAttacks/i.test(key)) continue;
                const sub = extractCombatHit(val, depth + 1, key);
                if (sub) return sub;
            }
        }
        return null;
    }

    function createMovesWindowDOM() {
        if (document.getElementById('piw-moves-window')) return;

        const win = document.createElement('div');
        win.id = 'piw-moves-window';

        const storedPos = GM_getValue('piw_moves_win_pos', { left: 760, top: 120 });
        const storedSize = GM_getValue('piw_moves_win_size', null);
        const mwL = parseFloat(storedPos.left);
        const mwT = parseFloat(storedPos.top);
        win.style.left = `${!isNaN(mwL) ? mwL : 760}px`;
        win.style.top = `${!isNaN(mwT) ? mwT : 120}px`;
        if (storedSize && storedSize.w) win.style.width = `${storedSize.w}px`;
        if (storedSize && storedSize.h) win.style.height = `${storedSize.h}px`;
        win.style.display = movesWindowVisible ? 'flex' : 'none';

        win.innerHTML = `
            <div class="piw-mw-head">
                <span class="piw-mw-title"><span class="piw-mw-dot"></span>⚔ Moves do Pokémon</span>
                <span class="piw-mw-close" id="piw-mw-close-btn" title="Fechar">✕</span>
            </div>
            <div class="piw-mw-body"></div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;

        makeBringableToFront(win);
        document.body.appendChild(win);
        applyOpacityAll();

        win.querySelector('#piw-mw-close-btn').addEventListener('click', closeMovesWindow);

        const head = win.querySelector('.piw-mw-head');
        makeDraggable(win, head, 'piw_moves_win_pos');

        const resizeHandle = win.querySelector('.piw-win-resize');
        makeResizable(win, resizeHandle, 'piw_moves_win_size', 220, 160);

        const handleSlotSelect = (e) => {
            const slot = e.target.closest('.piw-mw-party-slot');
            if (!slot) return;
            e.preventDefault();
            e.stopPropagation();
            const id = slot.dataset.id;
            const idx = parseInt(slot.dataset.idx, 10);
            let selected = null;
            if (currentPartyList && currentPartyList.length > 0) {
                if (id) selected = currentPartyList.find(p => String(p.id) === String(id));
                if (!selected && !isNaN(idx)) selected = currentPartyList[idx];
            }
            if (selected) {
                const isLead = selected.leader || (currentLeaderData && selected.id === currentLeaderData.id);
                if (isLead) {
                    inspectedMovesPokemon = null;
                } else {
                    inspectedMovesPokemon = selected;
                }
                renderMovesWindow();
            }
        };

        win.addEventListener('pointerdown', handleSlotSelect);
        win.addEventListener('click', handleSlotSelect);
    }

    function closeMovesWindow() {
        movesWindowVisible = false;
        GM_setValue('piw_moves_win_visible', false);
        const win = document.getElementById('piw-moves-window');
        if (win) win.style.display = 'none';
    }

    function toggleMovesWindow() {
        let win = document.getElementById('piw-moves-window');
        if (!win) {
            createMovesWindowDOM();
            win = document.getElementById('piw-moves-window');
        }
        if (!win) return;

        movesWindowVisible = !movesWindowVisible;
        GM_setValue('piw_moves_win_visible', movesWindowVisible);
        win.style.display = movesWindowVisible ? 'flex' : 'none';
        if (movesWindowVisible) {
            bringToFront(win);
            if (socket && socket.readyState === WebSocket.OPEN) {
                try { socket.send(JSON.stringify({ type: 'pokes-get' })); } catch(e){}
            }
            renderMovesWindow();
        }
    }

    function resetObservedMoves() {
        observedMovesMap.clear();
        if (movesWindowVisible) renderMovesWindow();
        GM_log('[AutoHunt] Golpes tomados nesta hunt foram resetados.');
    }

    // Impede que o mousedown nos botões de fechar ou interativos inicie o arrasto da janela
    document.addEventListener('mousedown', (e) => {
        if (e.target.closest('.piw-close, .piw-ah-close, .piw-tw-close, .piw-iw-close, .piw-mw-close, .piw-modal-close, [class*="close"], [id*="close"], [title*="Fechar"], input, button, select, label, .piw-tag-remove')) {
            e.stopPropagation();
        }
    }, true);

    // Escuta cliques no botão da casinha/cidade e hashchange para ocultar pokémon da caça
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-guide*="home"], button[data-guide*="city"], [class*="dock"] [class*="home"], [class*="dock"] [class*="city"], button.dock-btn');
        if (btn) {
            const text = (btn.textContent || '').toLowerCase();
            const guide = (btn.getAttribute('data-guide') || '').toLowerCase();
            if (guide.includes('home') || guide.includes('city') || text.includes('casa') || text.includes('home') || text.includes('cidade')) {
                huntingPokemon = '';
                GM_setValue('piw_huntingPokemon', '');
                resetObservedMoves();
                syncUI();
                GM_log('[AutoHunt] Clique na casinha/cidade detectado!');
            }
        }
        // Detecta clique em marcador de caça no mapa do jogo
        const marker = e.target.closest('button.hunt-marker, .hunt-marker');
        if (marker) {
            const nameEl = marker.querySelector('.hunt-name') || marker;
            const targetName = cleanPokemonName(nameEl.textContent);
            if (targetName && !/^(kanto|outland|johto|hoenn|sinnoh|cidade|centro)$/i.test(targetName)) {
                const targetKey = normalizeHuntKey(targetName);
                const curKey = normalizeHuntKey(huntSession?.huntName || currentRoute || trackerActiveSlug || '');
                const isSameHunt = targetKey && curKey && (targetKey === curKey);

                if (!isSameHunt) {
                    GM_log('[AutoHunt] Troca de hunt via mapa:', targetName);
                    const minAutoSaveMs = 10 * 60 * 1000;
                    if (huntSession && (huntSession.activeMs || 0) >= minAutoSaveMs && (huntSession.kills > 0 || huntSession.xp > 0)) {
                        saveCurrentRouteSession(false);
                    }
                    currentRoute = formatHuntName(targetName);
                    currentSlug = targetKey.replace(/\s+/g, '-');
                    trackerActiveSlug = targetKey;
                    huntingPokemon = '';
                    GM_setValue('piw_huntingPokemon', '');
                    resetTrackerSession(targetName);
                    resetObservedMoves();
                    syncUI();
                } else {
                    GM_log('[AutoHunt] Retornou para a mesma caça:', targetName, '(sessão mantida)');
                    currentRoute = formatHuntName(targetName);
                    currentSlug = targetKey.replace(/\s+/g, '-');
                    trackerActiveSlug = targetKey;
                    syncUI();
                }
            }
        }

        const depotBtn = e.target.closest('[class*="depot"], [class*="storage"], [class*="box"], [class*="pc"], button[data-guide*="depot"], button[data-guide*="storage"]');
        if (depotBtn) {
            if (socket && socket.readyState === WebSocket.OPEN) {
                try { socket.send(JSON.stringify({ type: 'pokes-get' })); } catch(e){}
            }
        }
    }, true);

    let hoveredDepotMonEl = null;

    function findPokemonFromElement(target) {
        if (!target || target === document.body || target === document.documentElement) return null;

        // Ignora qualquer elemento das janelas do próprio script
        if (target.closest('[id^="piw-"], .piw-panel, .piw-modal, .piw-tag, .piw-card, #piw-autohunt-window, #piw-tracker-window, #piw-info-window, #piw-moves-window, #piw-captures-window')) return null;

        // Ignora o log de captura do próprio jogo, chat, mensagens e histórico nativo do jogo
        if (target.closest('.log, .logs, .chat, .messages, [class*="log"], [class*="chat"], [class*="history"], [class*="toast"], [class*="notification"]')) return null;

        // Não inspeciona o HUD do time em batalha nem canvas de jogo
        if (target.closest('.phud-party, .party-container, .hud-party, button.dock-btn, .header, .nav, canvas')) return null;

        // Requer que o elemento esteja dentro de um container de Depot / Storage / PC Box
        const isDepot = target.closest('[class*="depot"], [class*="storage"], [class*="box"], [class*="pc"], .pokes-grid, .storage-grid, .depot-grid, .box-grid, .storage-modal, .depot-modal');
        if (!isDepot) return null;

        const monEl = target.closest('[data-poke-id], [data-id], [data-mon-id], [data-pokemon-id], [data-uid], [data-key], [class*="mon"], [class*="poke"], [class*="card"], [class*="item"], [class*="slot"], [class*="storage"], [class*="depot"], [class*="box"], [class*="entry"], [class*="grid-item"], button, div');
        if (!monEl) return null;
        if (monEl.closest('button.dock-btn, .header, .nav, .phud-party')) return null;

        // 1. Procura ID único no elemento ou filhos
        const idHolder = monEl.matches('[data-id], [data-poke-id], [data-mon-id], [data-pokemon-id], [data-uid], [data-key]')
            ? monEl
            : monEl.querySelector('[data-id], [data-poke-id], [data-mon-id], [data-pokemon-id], [data-uid], [data-key]');

        const dataId = idHolder?.getAttribute('data-id') ||
                       idHolder?.getAttribute('data-poke-id') ||
                       idHolder?.getAttribute('data-mon-id') ||
                       idHolder?.getAttribute('data-pokemon-id') ||
                       idHolder?.getAttribute('data-uid') ||
                       idHolder?.getAttribute('data-key') ||
                       idHolder?.dataset?.id ||
                       idHolder?.dataset?.pokeId;

        if (dataId) {
            if (allPokesList && allPokesList.length > 0) {
                const found = allPokesList.find(p => String(p.id) === String(dataId) || String(p._id) === String(dataId) || String(p.pokeId) === String(dataId) || String(p.uid) === String(dataId));
                if (found) return { mon: found, element: monEl };
            }
            if (captureLogs && captureLogs.length > 0) {
                const foundCap = captureLogs.find(p => String(p.id) === String(dataId));
                if (foundCap) return { mon: foundCap, element: monEl };
            }
        }

        const imgEl = monEl.querySelector('img');
        let imgSpeciesId = null;
        if (imgEl && imgEl.src) {
            const srcMatch = imgEl.src.match(/(?:pokemon|sprites)[^\/]*\/(\d+)\.(?:png|gif|webp)/i);
            if (srcMatch) imgSpeciesId = Number(srcMatch[1]);
        }

        const nameEl = monEl.querySelector('[class*="name"], .title, b, strong, .label');
        const rawName = nameEl?.textContent || imgEl?.alt || imgEl?.title || monEl.getAttribute('title') || monEl.getAttribute('aria-label') || '';
        const cleanName = cleanPokemonName(rawName);

        const fullText = (monEl.textContent || '') + ' ' + (monEl.getAttribute('title') || '') + ' ' + (monEl.getAttribute('aria-label') || '');

        const lvEl = monEl.querySelector('[class*="lv"], [class*="level"]');
        const lvMatch = (lvEl?.textContent || fullText).match(/(?:lv|nv|lvl|level)\.?\s*(\d+)/i);
        const level = lvMatch ? Number(lvMatch[1]) : null;

        const qualMatch = fullText.match(/(?:qualidade|quality|qual|q|tier)\.?\s*([0-9]+(?:\.[0-9]+)?)/i);
        const domQuality = qualMatch ? parseFloat(qualMatch[1]) : null;

        const ivMatch = fullText.match(/(?:iv|ivs|ivtotal)\.?\s*(\d+)/i);
        const domIvTotal = ivMatch ? Number(ivMatch[1]) : null;

        const isShinyEl = Boolean(
            monEl.classList.contains('shiny') ||
            monEl.querySelector('.shiny, [class*="shiny"]') ||
            /shiny|✨|★/i.test(fullText) ||
            imgEl?.src?.includes('/shiny/')
        );

        // Identifica o índice do slot dentro do container do Depot/Box
        const parentContainer = monEl.parentElement;
        const siblingCards = parentContainer ? Array.from(parentContainer.children).filter(c => c.querySelector('img') || c.matches('[class*="mon"], [class*="poke"], [class*="slot"], [class*="card"]')) : [];
        const cardSlotIndex = siblingCards.indexOf(monEl);

        if (allPokesList && allPokesList.length > 0) {
            let candidates = allPokesList;

            if (cleanName) {
                candidates = candidates.filter(p => cleanPokemonName(p.name).toLowerCase() === cleanName.toLowerCase());
            } else if (imgSpeciesId) {
                candidates = candidates.filter(p => Number(p.speciesId || p.pokeId) === imgSpeciesId);
            } else {
                candidates = [];
            }

            if (candidates.length === 1) {
                return { mon: candidates[0], element: monEl };
            }

            if (candidates.length > 1) {
                // Prioriza pokémons que NÃO estão no time de batalha ativo quando inspecionando depot
                const nonTeamCandidates = candidates.filter(p => !p.team && !p.leader);
                const pool = nonTeamCandidates.length > 0 ? nonTeamCandidates : candidates;

                let filteredPool = pool;
                if (level !== null) {
                    const byLv = filteredPool.filter(p => Number(p.level || p.lvl) === level);
                    if (byLv.length > 0) filteredPool = byLv;
                }
                if (isShinyEl) {
                    const byShiny = filteredPool.filter(p => Boolean(p.shiny));
                    if (byShiny.length > 0) filteredPool = byShiny;
                }
                if (domQuality !== null) {
                    const byQual = filteredPool.filter(p => Math.abs(Number(p.quality || 1) - domQuality) < 0.05);
                    if (byQual.length > 0) filteredPool = byQual;
                }

                if (filteredPool.length === 1) {
                    return { mon: filteredPool[0], element: monEl };
                }

                // Se houver múltiplos do mesmo nível/espécie no depot, distribui por índice do slot
                if (filteredPool.length > 1 && cardSlotIndex >= 0) {
                    const chosen = filteredPool[cardSlotIndex % filteredPool.length];
                    return { mon: chosen, element: monEl };
                }

                if (filteredPool.length > 0) {
                    return { mon: filteredPool[0], element: monEl };
                }
            }
        }

        // Verifica no histórico de capturas recente
        if (captureLogs && captureLogs.length > 0 && (cleanName || imgSpeciesId)) {
            const capMatch = captureLogs.find(p =>
                (cleanName && p.name.toLowerCase() === cleanName.toLowerCase()) ||
                (imgSpeciesId && Number(p.speciesId) === imgSpeciesId)
            );
            if (capMatch) return { mon: capMatch, element: monEl };
        }

        // Fallback construído dinamicamente com os stats específicos da espécie e nível
        if (cleanName || imgSpeciesId) {
            const c = creatures.find(cr => (cleanName && cr.name?.toLowerCase() === cleanName.toLowerCase()) || (imgSpeciesId && (cr.pokeId || cr.id) === imgSpeciesId));
            if (c) {
                const specId = c.pokeId || c.id || imgSpeciesId;
                const monLvl = level || 1;
                const monQual = domQuality || 1;
                const base = getBaseStatsForSpecies(specId);
                const dynStats = base ? {
                    hp: calculateStatFormula(base.hp, 15, monLvl, Math.pow(monQual, QUALITY_EXP.hp)),
                    atk: calculateStatFormula(base.atk, 15, monLvl, Math.pow(monQual, QUALITY_EXP.atk)),
                    def: calculateStatFormula(base.def, 15, monLvl, Math.pow(monQual, QUALITY_EXP.def)),
                    spAtk: calculateStatFormula(base.spAtk, 15, monLvl, Math.pow(monQual, QUALITY_EXP.spAtk)),
                    spDef: calculateStatFormula(base.spDef, 15, monLvl, Math.pow(monQual, QUALITY_EXP.spDef)),
                    speed: calculateStatFormula(base.speed, 15, monLvl, Math.pow(monQual, QUALITY_EXP.speed))
                } : null;

                return {
                    mon: {
                        name: c.name,
                        speciesId: specId,
                        level: monLvl,
                        type1: c.type1,
                        type2: c.type2,
                        quality: monQual,
                        shiny: isShinyEl,
                        ivTotal: domIvTotal,
                        stats: dynStats
                    },
                    element: monEl
                };
            }
        }

        return null;
    }

    // Escuta hover em pokémons no Depot/Storage/Box
    document.addEventListener('mouseover', (e) => {
        const found = findPokemonFromElement(e.target);
        if (found) {
            if (hoveredDepotMonEl !== found.element) {
                hoveredDepotMonEl = found.element;
                inspectedPokemon = found.mon;
                if (infoWindowVisible) {
                    renderInfoWindow();
                }
            }
        }
    }, true);

    document.addEventListener('mouseout', (e) => {
        if (hoveredDepotMonEl && (!e.relatedTarget || !hoveredDepotMonEl.contains(e.relatedTarget))) {
            const movingToOtherMon = findPokemonFromElement(e.relatedTarget);
            if (!movingToOtherMon) {
                hoveredDepotMonEl = null;
                if (!isPartySlotPinned) {
                    inspectedPokemon = null;
                    if (infoWindowVisible) {
                        renderInfoWindow();
                    }
                }
            }
        }
    }, true);

    window.addEventListener('hashchange', () => {
        if (isCity() || /home|city|town|house/i.test(window.location.hash)) {
            resetObservedMoves();
        }
    });

    function renderMovesWindow() {
        const win = document.getElementById('piw-moves-window');
        if (!win || !movesWindowVisible) return;

        const body = win.querySelector('.piw-mw-body');
        if (!body) return;

        let targetMon = inspectedMovesPokemon || currentLeaderData || (currentPartyList && currentPartyList[0]) || null;
        if (!targetMon && leaderName) {
            targetMon = { name: leaderName, level: leaderLevel || 1 };
        }

        const isInspectingTeammate = Boolean(inspectedMovesPokemon && currentLeaderData && inspectedMovesPokemon.id !== currentLeaderData.id);
        const name = cleanPokemonName(targetMon?.name || leaderName || '?');
        const level = isInspectingTeammate ? (targetMon?.level || 1) : (leaderLevel || targetMon?.level || 1);

        let creature = creatures.find(c => c.name?.toLowerCase() === name.toLowerCase());

        const moves = extractPokemonMoves(targetMon, creature);
        const knownMovesMap = new Map(moves.map(m => [m.name.toLowerCase(), m]));
        const hasKnownMoves = moves.length > 0;

        const pokemonMoves = [...moves];
        const takenMovesMap = new Map();

        if (!isInspectingTeammate) {
            for (const [nameKey, obs] of observedMovesMap.entries()) {
                const isTaken = obs.taken || (hasKnownMoves && !knownMovesMap.has(nameKey));
                if (isTaken) {
                    takenMovesMap.set(nameKey, obs);
                } else {
                    if (knownMovesMap.has(nameKey)) {
                        const m = knownMovesMap.get(nameKey);
                        m.lastDmg = obs.dmg;
                        m.lastEff = obs.eff;
                        if (!m.type && obs.type) m.type = obs.type;
                    } else {
                        pokemonMoves.push({
                            name: obs.name,
                            type: obs.type,
                            lastDmg: obs.dmg,
                            lastEff: obs.eff,
                            observed: true
                        });
                    }
                }
            }
        }

        const takenMovesList = Array.from(takenMovesMap.values());

        let partyBarHtml = '';
        if (currentPartyList && currentPartyList.length > 0) {
            partyBarHtml = `
                <div class="piw-mw-party-bar" title="Clique para ver os golpes de qualquer Pokémon da sua equipe">
                    ${currentPartyList.map((p, idx) => {
                        const pName = cleanPokemonName(p.name);
                        const pSpecies = p.speciesId || p.pokeId || (() => {
                            const c = creatures.find(cr => cr.name?.toLowerCase() === pName.toLowerCase());
                            return c?.pokeId || c?.id || 0;
                        })();
                        const pSprites = getPokemonSpriteUrls(pSpecies, p.shiny);
                        const isSelected = (inspectedMovesPokemon && p.id === inspectedMovesPokemon.id) || (!inspectedMovesPokemon && (p.leader || (currentLeaderData && p.id === currentLeaderData.id)));
                        const isLead = p.leader || (currentLeaderData && p.id === currentLeaderData.id);
                        return `
                            <div class="piw-mw-party-slot ${isLead ? 'leader' : ''} ${isSelected ? 'inspected' : ''}" data-idx="${idx}" title="${pName} Lv. ${p.level || 1}${isLead ? ' (Líder)' : ''}">
                                <img src="${pSprites.still}" alt="${pName}" onerror="this.src='${pSprites.anim}'">
                                <span class="piw-slot-lv">${p.level || 1}</span>
                                ${isLead ? '<span class="piw-slot-leader">⭐</span>' : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        const renderMoveItem = (m, isTaken = false) => {
            const typeKey = m.type ? String(m.type).toLowerCase() : null;
            const bgType = typeKey && TYPE_COLORS_MAP[typeKey] ? TYPE_COLORS_MAP[typeKey] : null;
            const ptType = typeKey && TYPE_PT_MAP[typeKey] ? TYPE_PT_MAP[typeKey] : (m.type || 'Normal');

            const isCurrent = !isTaken && !isInspectingTeammate && currentActiveMove && m.name.toLowerCase() === currentActiveMove.toLowerCase();
            const dmgVal = m.lastDmg ?? m.dmg;
            const effVal = m.lastEff ?? m.eff;
            const effTxt = Number.isFinite(Number(effVal)) && Number(effVal) !== 1 ? `${Math.round(Number(effVal) * 100) / 100}x` : '';

            return `
                <div class="piw-mw-move ${isCurrent ? 'piw-mw-active' : ''}">
                    <span class="piw-mw-move-name" style="font-size:12px;font-weight:600">
                        ${isCurrent ? '▶ ' : ''}${m.name}
                        ${m.learnLevel != null ? `<span class="piw-mw-move-lv" style="font-size:10px;font-weight:700">Nv ${m.learnLevel}</span>` : ''}
                        ${getMoveClassBadge(m.category)}
                    </span>
                    <span class="piw-mw-move-meta">
                        ${bgType ? `<span class="piw-iw-type" style="background:${bgType};font-size:10px;padding:1px 6px;font-weight:700">${ptType}</span>` : ''}
                        ${m.power != null ? `<span style="color:#cbd5e1;font-size:11px;font-weight:600">poder ${m.power}</span>` : ''}
                        ${dmgVal != null ? `
                            <span style="color:${isTaken ? '#fca5a5' : '#fde047'};font-weight:700;font-size:12px">
                                ${isTaken ? '🛡' : '💥'} ${Number(dmgVal).toLocaleString('pt-BR')}
                            </span>
                            ${effTxt ? `<span style="color:#cbd5e1;font-size:11px;font-weight:600">${effTxt}</span>` : ''}
                        ` : ''}
                    </span>
                </div>
            `;
        };

        if (pokemonMoves.length === 0 && takenMovesList.length === 0) {
            body.innerHTML = `
                ${partyBarHtml}
                <div class="piw-mw-sub" style="margin-bottom:6px;font-size:12.5px;color:#fff">⚔ Moves de ${name} (Lv ${level})</div>
                <div style="color:#cbd5e1;padding:12px 6px;text-align:center;font-size:11.5px;line-height:1.4">
                    Ainda não vi os moves deste pokémon.<br>
                    Deixe-o batalhar — os golpes usados e o dano aparecem aqui automaticamente.
                </div>
            `;
        } else {
            let html = partyBarHtml;
            html += `<div class="piw-mw-sub" style="margin-bottom:6px;font-size:12.5px;color:#fff">⚔ Moves de <b>${name}</b> (Lv ${level})</div>`;
            html += pokemonMoves.map(m => renderMoveItem(m, false)).join('');

            if (takenMovesList.length > 0) {
                html += `<div class="piw-mw-sub" style="margin-top:12px;margin-bottom:6px;font-size:12px;color:#a5b4fc;font-weight:700">🛡 GOLPES RECEBIDOS <small style="color:#cbd5e1;text-transform:none;letter-spacing:0;font-size:11px;font-weight:500">· nesta hunt</small></div>`;
                html += takenMovesList.map(m => renderMoveItem(m, true)).join('');
            }

            body.innerHTML = html;
        }
    }

    // ========== CATÁLOGO DE ITENS E MOTOR DE HUNT NATIVO (100% AUTÔNOMO) ==========
    const gameItemsMap = new Map();
    try {
        fetch('/game/items.json')
            .then(r => r.json())
            .then(data => {
                const list = Array.isArray(data?.items) ? data.items : [];
                for (const it of list) {
                    if (it && it.id != null) gameItemsMap.set(Number(it.id), it);
                }
            })
            .catch(() => {});
    } catch(e) {}

    function getItemNpcPrice(itemId, fallbackPrice) {
        if (!itemId && !fallbackPrice) return 0;
        const it = gameItemsMap.get(Number(itemId));
        if (it) {
            const p = Number(it.npcPrice ?? it.priceNpc ?? it.sellPrice ?? it.price ?? it.priceGold ?? it.value);
            if (Number.isFinite(p) && p >= 0) return p;
        }
        const fallback = Number(fallbackPrice);
        return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
    }

    let gameBallPrices = { 1: 5, 2: 81, 4: 130, 6: 400 };
    let gameBallCatalog = {};
    let lastKnownBallsCounts = null;
    let gamePotionPrices = { 200: 5, 201: 10, 202: 22, 203: 55, 204: 230, 205: 40, 206: 350 };
    const knownPlayerPokeIds = new Set();
    let initialPokesLoaded = false;

    const lastKnownPotionCounts = new Map();
    function trackInventoryPotions(obj) {
        if (!obj || typeof obj !== 'object') return;
        const currentCounts = new Map();

        function scan(o, depth = 0) {
            if (!o || typeof o !== 'object' || depth > 5) return;
            if (Array.isArray(o)) {
                for (const item of o) scan(item, depth + 1);
                return;
            }
            const itemId = Number(o.itemId ?? o.id);
            const qty = Number(o.qty ?? o.count ?? o.quantity ?? o.amount);
            if (Number.isFinite(itemId) && Number.isFinite(qty)) {
                const it = gameItemsMap.get(itemId);
                const cat = it?.category;
                if (cat === 'heal' || cat === 'revive' || (itemId >= 200 && itemId <= 206)) {
                    currentCounts.set(itemId, qty);
                }
            }
            for (const [k, v] of Object.entries(o)) {
                const kNum = Number(k);
                if (Number.isFinite(kNum) && typeof v === 'number' && (kNum >= 200 && kNum <= 206)) {
                    currentCounts.set(kNum, v);
                } else if (typeof v === 'object') {
                    scan(v, depth + 1);
                }
            }
        }

        scan(obj);

        if (currentCounts.size > 0 && lastKnownPotionCounts.size > 0) {
            for (const [id, count] of currentCounts) {
                const prev = lastKnownPotionCounts.get(id);
                if (prev !== undefined && count < prev) {
                    const diff = prev - count;
                    huntSession.potions += diff;
                    huntSession.potionsByType[id] = (huntSession.potionsByType[id] || 0) + diff;
                }
            }
        }

        for (const [id, count] of currentCounts) {
            lastKnownPotionCounts.set(id, count);
        }
    }

    function loadSavedHuntSession() {
        try {
            const raw = GM_getValue('piw_saved_hunt_session', null);
            if (raw && typeof raw === 'object') {
                const dropsMap = new Map();
                if (Array.isArray(raw.dropsList)) {
                    for (const item of raw.dropsList) {
                        if (item && item.key) dropsMap.set(item.key, item.data);
                    }
                }
                const capturedPokes = Array.isArray(raw.capturedPokes) ? raw.capturedPokes : [];
                const cleanSlug = (typeof raw.slug === 'string' && raw.slug.trim()) ? raw.slug.trim() : null;
                const cleanName = (typeof raw.huntName === 'string' && raw.huntName.trim()) ? raw.huntName.trim() : null;
                return {
                    startAt: Number(raw.startAt) || Date.now(),
                    slug: cleanSlug,
                    huntName: cleanName,
                    speciesId: raw.speciesId || null,
                    activeMs: Number(raw.activeMs) || 0,
                    lastTickAt: null,
                    kills: Number(raw.kills) || 0,
                    xp: Number(raw.xp) || 0,
                    caps: Number(raw.caps) || capturedPokes.length,
                    capsValue: Number(raw.capsValue) || capturedPokes.reduce((sum, p) => sum + (Number(p.sellValue) || 0), 0),
                    capturedPokes: capturedPokes,
                    balls: Number(raw.balls) || 0,
                    ballsByType: raw.ballsByType || {},
                    potions: Number(raw.potions) || 0,
                    potionsByType: raw.potionsByType || {},
                    drops: dropsMap
                };
            }
        } catch(e) {}
        return null;
    }

    function persistHuntSession() {
        try {
            if (!huntSession) return;
            const dropsList = [];
            if (huntSession.drops && typeof huntSession.drops.entries === 'function') {
                for (const [key, data] of huntSession.drops.entries()) {
                    dropsList.push({ key, data });
                }
            }
            const cleanSlug = (typeof huntSession.slug === 'string' && huntSession.slug.trim()) ? huntSession.slug.trim() : null;
            const cleanName = (typeof huntSession.huntName === 'string' && huntSession.huntName.trim()) ? huntSession.huntName.trim() : 'Rota';
            const toSave = {
                startAt: Number(huntSession.startAt) || Date.now(),
                slug: cleanSlug,
                huntName: cleanName,
                speciesId: huntSession.speciesId || null,
                activeMs: Number(huntSession.activeMs) || 0,
                kills: Number(huntSession.kills) || 0,
                xp: Number(huntSession.xp) || 0,
                caps: Number(huntSession.caps) || 0,
                capsValue: Number(huntSession.capsValue) || 0,
                capturedPokes: Array.isArray(huntSession.capturedPokes) ? huntSession.capturedPokes : [],
                balls: Number(huntSession.balls) || 0,
                ballsByType: huntSession.ballsByType || {},
                potions: Number(huntSession.potions) || 0,
                potionsByType: huntSession.potionsByType || {},
                dropsList: dropsList
            };
            GM_setValue('piw_saved_hunt_session', toSave);
        } catch(e) {}
    }

    let huntSession = loadSavedHuntSession() || {
        startAt: Date.now(),
        slug: null,
        huntName: null,
        speciesId: null,
        activeMs: 0,
        lastTickAt: null,
        kills: 0,
        xp: 0,
        caps: 0,
        capsValue: 0,
        capturedPokes: [],
        balls: 0,
        ballsByType: {},
        potions: 0,
        potionsByType: {},
        drops: new Map() // key -> { name, itemId, qty, price, icon }
    };

    // ========== JANELA DE RENDIMENTO / FARM TRACKER ==========
    let trackerWindowVisible = GM_getValue('piw_tracker_win_visible', false);
    let trackerActiveTab = 'session'; // 'session' | 'history'
    let trackerActiveSlug = (huntSession?.slug && typeof huntSession.slug === 'string') ? huntSession.slug.toLowerCase().trim() : '';
    let historySortBy = 'recent'; // 'recent' | 'exp' | 'net'
    let routeHistory = GM_getValue('piw_route_history', []);
    let trackerInterval = null;

    function getPokemonSpriteUrl(pokeNameOrId) {
        if (!pokeNameOrId) return '';
        const num = Number(pokeNameOrId);
        if (Number.isFinite(num) && num > 0 && num < 10000) {
            return getPokemonImageUrl(num, '');
        }
        return getPokemonImageUrl(0, String(pokeNameOrId));
    }

    function isCitySlug(slug) {
        if (!slug || typeof slug !== 'string') return true;
        const s = String(slug).toLowerCase().trim();
        if (CITY_SLUGS.has(s)) return true;
        return /cidade|city|town|village|cassino|casino|depot|center|market|pallet|viridian|pewter|cerulean|vermilion|lavender|celadon|fuchsia|saffron|cinnabar|pokecenter/i.test(s);
    }

    function isHuntActive() {
        if (!huntSession || !huntSession.lastTickAt) return false;
        return (Date.now() - huntSession.lastTickAt) < 3500;
    }

    function getTrackerElapsedSec() {
        return Math.max(0, Math.floor((huntSession?.activeMs || 0) / 1000));
    }

    function getSessionLootTotal() {
        if (!huntSession?.drops || typeof huntSession.drops.values !== 'function') return 0;
        let total = 0;
        for (const d of huntSession.drops.values()) {
            total += (Number(d.qty) || 0) * (Number(d.price) || 0);
        }
        return total;
    }

    function getSessionCapsTotal() {
        return Number(huntSession?.capsValue || 0);
    }

    function getSessionSupplyTotal() {
        if (!huntSession) return 0;
        const effectiveBalls = Math.max(huntSession.balls || 0, huntSession.kills || 0);
        let ballsCost = 0;
        if (huntSession.balls > 0 && huntSession.ballsByType) {
            for (const [id, qty] of Object.entries(huntSession.ballsByType)) {
                ballsCost += (Number(qty) || 0) * (gameBallPrices[id] || 81);
            }
        } else {
            ballsCost = effectiveBalls * (gameBallPrices[2] || 81);
        }

        let potionsCost = 0;
        if (huntSession.potionsByType) {
            for (const [id, qty] of Object.entries(huntSession.potionsByType)) {
                potionsCost += (Number(qty) || 0) * (gamePotionPrices[id] || 300);
            }
        }
        return ballsCost + potionsCost;
    }

    function onRouteOrHuntChange(newSlug) {
        const rawKey = normalizeHuntKey(newSlug || currentSlug || '');
        if (!rawKey || isCitySlug(rawKey)) return;

        // Se for a primeira inicialização após carregar a página
        if (!trackerActiveSlug) {
            trackerActiveSlug = rawKey;
            if (huntSession) {
                huntSession.slug = rawKey;
                if (!huntSession.huntName || /cidade|centro/i.test(huntSession.huntName)) {
                    huntSession.huntName = getDisplayHuntName() || formatHuntName(rawKey);
                }
            }
            return;
        }

        // Se REALMENTE trocou para uma hunt diferente
        if (rawKey !== normalizeHuntKey(trackerActiveSlug)) {
            // Salva a hunt anterior no histórico apenas se tiver durado no mínimo 10 minutos (600.000 ms)
            const minAutoSaveMs = 10 * 60 * 1000; // 10 minutos
            if (huntSession && (huntSession.activeMs || 0) >= minAutoSaveMs && (huntSession.kills > 0 || huntSession.xp > 0)) {
                saveCurrentRouteSession(false); // false para não trocar a aba ativa
            }

            trackerActiveSlug = rawKey;
            resetTrackerSession(newSlug);
        }
    }

    function resetTrackerSession(newSlug) {
        const cleanSlug = (typeof newSlug === 'string' && newSlug.trim()) ? newSlug.trim() : (typeof currentSlug === 'string' && currentSlug.trim() ? currentSlug.trim() : null);
        const cleanName = (typeof cleanSlug === 'string' && !/^(kanto|outland)$/i.test(cleanSlug)) ? cleanSlug : (getDisplayHuntName(true) || 'Rota');
        huntSession = {
            startAt: Date.now(),
            slug: cleanSlug,
            huntName: cleanName,
            speciesId: null,
            activeMs: 0,
            lastTickAt: null,
            kills: 0,
            xp: 0,
            caps: 0,
            capsValue: 0,
            capturedPokes: [],
            balls: 0,
            ballsByType: {},
            potions: 0,
            potionsByType: {},
            drops: new Map()
        };
        lastHeroHp = null;
        lastHeroMaxHp = null;
        persistHuntSession();
        if (trackerWindowVisible) renderTrackerWindow();
        GM_log('[AutoHunt] Sessão de rendimento resetada para:', huntSession.huntName);
    }

    function saveCurrentRouteSession(switchToHistoryTab = true) {
        const elapsedSec = Math.max(1, getTrackerElapsedSec());
        const hours = Math.max(1 / 3600, elapsedSec / 3600);
        const lootGained = getSessionLootTotal();
        const capsGained = getSessionCapsTotal();
        const supplyCost = getSessionSupplyTotal();
        const expPerHour = Math.round(huntSession.xp / hours);
        const lootPerHour = Math.round((lootGained + capsGained) / hours);
        const supplyPerHour = Math.round(supplyCost / hours);
        const netBalance = lootGained + capsGained - supplyCost;
        const netPerHour = Math.round(netBalance / hours);
        const killsPerHour = Math.round(huntSession.kills / hours);

        const routeTitle = huntSession?.huntName || huntSession?.slug || getDisplayHuntName() || currentRoute || currentSlug || 'Rota';

        const entry = {
            id: Date.now(),
            route: routeTitle,
            leaderName: cleanPokemonName(leaderName || '?'),
            leaderLevel: leaderLevel || 1,
            durationSec: elapsedSec,
            expGained: huntSession.xp,
            expPerHour: expPerHour,
            lootGained: lootGained,
            capsGained: capsGained,
            lootPerHour: lootPerHour,
            supplyCost: supplyCost,
            supplyPerHour: supplyPerHour,
            netBalance: netBalance,
            netPerHour: netPerHour,
            kills: huntSession.kills,
            killsPerHour: killsPerHour,
            caps: huntSession.caps,
            date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        };

        routeHistory.unshift(entry);
        if (routeHistory.length > 50) routeHistory.pop();
        GM_setValue('piw_route_history', routeHistory);
        if (switchToHistoryTab) {
            trackerActiveTab = 'history';
        }
        renderTrackerWindow();
        GM_log('[AutoHunt] Sessão salva automaticamente no histórico:', entry.route);
    }

    function createTrackerWindowDOM() {
        if (document.getElementById('piw-tracker-window')) return;

        const win = document.createElement('div');
        win.id = 'piw-tracker-window';

        const storedPos = GM_getValue('piw_tracker_win_pos', { left: 400, top: 380 });
        const storedSize = GM_getValue('piw_tracker_win_size', null);
        const twL = parseFloat(storedPos.left);
        const twT = parseFloat(storedPos.top);
        win.style.left = `${!isNaN(twL) ? twL : 400}px`;
        win.style.top = `${!isNaN(twT) ? twT : 380}px`;
        if (storedSize && storedSize.w) win.style.width = `${storedSize.w}px`;
        if (storedSize && storedSize.h) win.style.height = `${storedSize.h}px`;
        win.style.display = trackerWindowVisible ? 'flex' : 'none';

        win.innerHTML = `
            <div class="piw-tw-head">
                <span class="piw-tw-title"><span class="piw-tw-dot"></span>⏱️ Hunt Analyzer</span>
                <span class="piw-tw-close" id="piw-tw-close-btn" title="Fechar">✕</span>
            </div>
            <div class="piw-tw-tabs">
                <button class="piw-tw-tab active" id="piw-tw-tab-session">⏱️ Sessão Atual</button>
                <button class="piw-tw-tab" id="piw-tw-tab-history">🏆 Histórico de Rotas</button>
            </div>
            <div class="piw-tw-body"></div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;

        makeBringableToFront(win);
        document.body.appendChild(win);
        applyOpacityAll();

        win.querySelector('#piw-tw-close-btn').addEventListener('click', closeTrackerWindow);

        win.querySelector('#piw-tw-tab-session').addEventListener('click', () => {
            trackerActiveTab = 'session';
            renderTrackerWindow();
        });

        win.querySelector('#piw-tw-tab-history').addEventListener('click', () => {
            trackerActiveTab = 'history';
            renderTrackerWindow();
        });

        const head = win.querySelector('.piw-tw-head');
        makeDraggable(win, head, 'piw_tracker_win_pos');

        const resizeHandle = win.querySelector('.piw-win-resize');
        makeResizable(win, resizeHandle, 'piw_tracker_win_size', 340, 200);
    }

    function closeTrackerWindow() {
        trackerWindowVisible = false;
        GM_setValue('piw_tracker_win_visible', false);
        trackerActiveTab = 'session';
        const win = document.getElementById('piw-tracker-window');
        if (win) win.style.display = 'none';
        if (trackerInterval) {
            clearInterval(trackerInterval);
            trackerInterval = null;
        }
    }

    function toggleTrackerWindow() {
        let win = document.getElementById('piw-tracker-window');
        if (!win) {
            createTrackerWindowDOM();
            win = document.getElementById('piw-tracker-window');
        }
        if (!win) return;

        trackerWindowVisible = !trackerWindowVisible;
        GM_setValue('piw_tracker_win_visible', trackerWindowVisible);
        win.style.display = trackerWindowVisible ? 'flex' : 'none';
        if (trackerWindowVisible) {
            trackerActiveTab = 'session';
            bringToFront(win);
            renderTrackerWindow();
            if (!trackerInterval) {
                trackerInterval = setInterval(() => {
                    if (trackerWindowVisible && trackerActiveTab === 'session') {
                        renderTrackerWindow();
                    }
                }, 1000);
            }
        } else {
            trackerActiveTab = 'session';
            if (trackerInterval) {
                clearInterval(trackerInterval);
                trackerInterval = null;
            }
        }
    }

    function formatDuration(totalSeconds) {
        const hrs = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        if (hrs > 0) {
            return `${hrs}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
        }
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function renderTrackerWindow() {
        const win = document.getElementById('piw-tracker-window');
        if (!win || !trackerWindowVisible) return;

        const body = win.querySelector('.piw-tw-body');
        if (!body) return;

        const tabSessionBtn = win.querySelector('#piw-tw-tab-session');
        const tabHistoryBtn = win.querySelector('#piw-tw-tab-history');
        if (tabSessionBtn && tabHistoryBtn) {
            tabSessionBtn.className = `piw-tw-tab ${trackerActiveTab === 'session' ? 'active' : ''}`;
            tabHistoryBtn.className = `piw-tw-tab ${trackerActiveTab === 'history' ? 'active' : ''}`;
            tabHistoryBtn.textContent = `🏆 Histórico (${routeHistory.length})`;
        }

        if (trackerActiveTab === 'history') {
            if (!routeHistory || routeHistory.length === 0) {
                body.innerHTML = `
                    <div style="text-align:center;color:#7d86ad;padding:30px 10px">
                        <div style="font-size:26px;margin-bottom:8px">📊</div>
                        <b>Nenhuma rota salva ainda.</b><br>
                        <span style="font-size:11px">Ao mudar de hunt ou clicar em <b>"💾 Salvar no Histórico"</b>, seus farms aparecerão aqui!</span>
                    </div>
                `;
                return;
            }

            const maxExp = Math.max(...routeHistory.map(r => r.expPerHour || 0), 1);
            const maxProfit = Math.max(...routeHistory.map(r => r.netPerHour || 0), 1);

            let sortedHistory = [...routeHistory];
            if (historySortBy === 'exp') {
                sortedHistory.sort((a, b) => (b.expPerHour || 0) - (a.expPerHour || 0));
            } else if (historySortBy === 'net') {
                sortedHistory.sort((a, b) => (b.netPerHour || 0) - (a.netPerHour || 0));
            } else {
                sortedHistory.sort((a, b) => b.id - a.id);
            }

            let html = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="display:flex;gap:4px">
                        <button class="piw-tw-sort-btn ${historySortBy === 'recent' ? 'active' : ''}" data-sort="recent">🕒 Recentes</button>
                        <button class="piw-tw-sort-btn ${historySortBy === 'exp' ? 'active' : ''}" data-sort="exp">✨ Top XP/h</button>
                        <button class="piw-tw-sort-btn ${historySortBy === 'net' ? 'active' : ''}" data-sort="net">💰 Top Lucro/h</button>
                    </div>
                    <button id="piw-tw-clear-history" style="background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.3);color:#f87171;border-radius:6px;padding:2px 8px;font-size:10px;cursor:pointer;font-weight:700">Limpar Tudo</button>
                </div>
            `;

            html += sortedHistory.map((item) => {
                const isBestExp = item.expPerHour === maxExp && item.expPerHour > 0;
                const isBestProfit = item.netPerHour === maxProfit && item.netPerHour > 0;
                const isNetPositive = (item.netBalance ?? 0) >= 0;
                const sign = isNetPositive ? '+' : '-';
                const absNet = Math.abs(item.netBalance ?? 0);
                const absNetHour = Math.abs(item.netPerHour ?? 0);
                const sprite = getPokemonSpriteUrl(item.route);

                return `
                    <div class="piw-tw-history-item${isBestExp ? ' best-exp' : ''}">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start">
                            <div>
                                <div style="display:flex;align-items:center;gap:6px">
                                    ${sprite ? `<img src="${sprite}" style="width:22px;height:22px;object-fit:contain;image-rendering:pixelated" onerror="this.style.display='none'">` : ''}
                                    <span style="font-weight:700;color:#fff;font-size:13px">${cleanPokemonName(item.route)}</span>
                                    ${isBestExp ? '<span class="piw-tw-badge-best">🏆 TOP XP</span>' : ''}
                                    ${isBestProfit ? '<span class="piw-tw-badge-best" style="background:linear-gradient(135deg,#eab308,#ca8a04)">💰 TOP LUCRO</span>' : ''}
                                </div>
                                <div style="font-size:11.5px;font-weight:600;color:#cbd5e1;margin-top:4px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px">
                                    <span style="white-space:nowrap">👑 <b style="color:#fff">${item.leaderName}</b> (Nv. ${item.leaderLevel})</span>
                                    <span style="color:rgba(255,255,255,.3)">·</span>
                                    <span style="white-space:nowrap">⏱️ <b style="color:#93c5fd">${formatDuration(item.durationSec)}</b></span>
                                    <span style="color:rgba(255,255,255,.3)">·</span>
                                    <span style="white-space:nowrap">⚔️ <b style="color:#a5b4fc">${item.kills}</b> abates</span>
                                    ${item.caps ? `<span style="color:rgba(255,255,255,.3)">·</span><span style="white-space:nowrap">🔴 <b style="color:#86efac">${item.caps}</b> caps</span>` : ''}
                                    <span style="color:rgba(255,255,255,.3)">·</span>
                                    <span style="white-space:nowrap">📅 <b style="color:#fde047">${item.date}</b></span>
                                </div>
                            </div>
                            <button class="piw-tw-del-item" data-id="${item.id}" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:15px;padding:2px 6px;line-height:1" title="Excluir do histórico">✕</button>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;margin-top:8px;background:rgba(0,0,0,.25);padding:8px 6px;border-radius:8px;border:1px solid rgba(255,255,255,.06)">
                            <div style="text-align:center">
                                <div style="font-size:10.5px;font-weight:700;color:#cbd5e1;letter-spacing:.3px">✨ XP / HORA</div>
                                <div style="font-size:13px;font-weight:700;color:#34d399;margin-top:2px">${Number(item.expPerHour || 0).toLocaleString('pt-BR')}</div>
                            </div>
                            <div style="text-align:center">
                                <div style="font-size:10.5px;font-weight:700;color:#cbd5e1;letter-spacing:.3px">📈 SALDO / H</div>
                                <div style="font-size:13px;font-weight:700;color:${isNetPositive ? '#4ade80' : '#f87171'};margin-top:2px">${sign}$${Number(absNetHour).toLocaleString('pt-BR')}</div>
                            </div>
                            <div style="text-align:center">
                                <div style="font-size:10.5px;font-weight:700;color:#cbd5e1;letter-spacing:.3px">⚔️ ABATES / H</div>
                                <div style="font-size:13px;font-weight:700;color:#60a5fa;margin-top:2px">${Number(item.killsPerHour || 0).toLocaleString('pt-BR')}/h</div>
                            </div>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:600;color:#cbd5e1;margin-top:6px;padding:0 4px">
                            <span>Loot: <b style="color:#facc15">$${Number(item.lootGained || 0).toLocaleString('pt-BR')}</b></span>
                            <span>Supply: <b style="color:#fca5a5">-$${Number(item.supplyCost || 0).toLocaleString('pt-BR')}</b></span>
                            <span>Saldo: <b style="color:${isNetPositive ? '#86efac' : '#fca5a5'}">${sign}$${Number(absNet).toLocaleString('pt-BR')}</b></span>
                        </div>
                    </div>
                `;
            }).join('');

            body.innerHTML = html;

            body.querySelectorAll('.piw-tw-sort-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    historySortBy = btn.dataset.sort;
                    renderTrackerWindow();
                });
            });

            body.querySelector('#piw-tw-clear-history')?.addEventListener('click', () => {
                if (confirm('Tem certeza que deseja limpar todo o histórico de rotas salvas?')) {
                    routeHistory = [];
                    GM_setValue('piw_route_history', []);
                    renderTrackerWindow();
                }
            });

            body.querySelectorAll('.piw-tw-del-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = Number(btn.dataset.id);
                    routeHistory = routeHistory.filter(r => r.id !== id);
                    GM_setValue('piw_route_history', routeHistory);
                    renderTrackerWindow();
                });
            });
            return;
        }

        // Tab 'session'
        const elapsedSec = getTrackerElapsedSec();
        const hours = Math.max(1 / 3600, elapsedSec / 3600);
        const sessionLoot = getSessionLootTotal();
        const sessionCaps = getSessionCapsTotal();
        const sessionSupply = getSessionSupplyTotal();
        const expPerHour = elapsedSec > 0 ? Math.round(huntSession.xp / hours) : 0;
        const lootPerHour = elapsedSec > 0 ? Math.round(sessionLoot / hours) : 0;
        const supplyPerHour = elapsedSec > 0 ? Math.round(sessionSupply / hours) : 0;
        const netBalance = sessionLoot + sessionCaps - sessionSupply;
        const netPerHour = elapsedSec > 0 ? Math.round(netBalance / hours) : 0;
        const killsPerHour = elapsedSec > 0 ? Math.round(huntSession.kills / hours) : 0;

        const isNetPositive = netBalance >= 0;
        const sign = isNetPositive ? '+' : '-';
        const absNet = Math.abs(netBalance);

        const nextLevel = (leaderLevel || 1) + 1;
        const partyStats = getPartyMonStatsFromDOM(0, leaderName);
        const expPct = partyStats?.expPct ?? currentLeaderData?.expPct ?? null;
        let etaVal = `Nv. ${nextLevel}`;
        let etaSub = 'Previsão em tempo real';

        if (expPct !== null && expPct >= 0 && expPct < 100) {
            const remainingPct = 100 - expPct;
            if (expPerHour > 0 && huntSession.xp > 0 && elapsedSec >= 5) {
                const approxLevelExp = Math.max(2000, 3 * (leaderLevel || 1) * (leaderLevel || 1) * 12);
                const remainingExp = (remainingPct / 100) * approxLevelExp;
                const etaMins = Math.round((remainingExp / expPerHour) * 60);
                if (etaMins > 0 && etaMins < 6000) {
                    const formattedEta = etaMins >= 60 ? `${Math.floor(etaMins/60)}h ${etaMins%60}m` : `${etaMins} min`;
                    etaVal = `Lv. ${nextLevel} em ~${formattedEta}`;
                    etaSub = `${remainingPct.toFixed(1)}% restante`;
                } else {
                    etaVal = `Lv. ${nextLevel}`;
                    etaSub = `${remainingPct.toFixed(1)}% restante`;
                }
            } else {
                etaVal = `Lv. ${nextLevel}`;
                etaSub = `${remainingPct.toFixed(1)}% restante`;
            }
        }

        const formattedTime = formatDuration(elapsedSec);
        const active = isHuntActive();
        const isPaused = !active;
        const statusLabel = isPaused ? (elapsedSec === 0 ? 'AGUARDANDO COMBATE' : 'TEMPO NA HUNT · PAUSADO') : 'TEMPO NA HUNT';
        const timerColor = isPaused ? '#facc15' : '#34d399';
        const locationTitle = getDisplayHuntName();

        body.innerHTML = `
            <div class="piw-card" style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-weight:700;font-size:13.5px;color:#fff">${locationTitle}</div>
                        <div style="font-size:11.5px;color:#e2e8f0;margin-top:2px">👑 ${cleanPokemonName(leaderName || '?')} <span style="color:#93c5fd;font-weight:700">Lv. ${leaderLevel || 1}</span></div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:13.5px;font-weight:700;color:${timerColor};font-variant-numeric:tabular-nums">${isPaused && elapsedSec > 0 ? '⏸️ ' : ''}${formattedTime}</div>
                        <div style="font-size:10.5px;font-weight:600;color:${isPaused && elapsedSec > 0 ? '#fca5a5' : '#cbd5e1'}">${statusLabel}</div>
                    </div>
                </div>
            </div>

            <div class="piw-tw-grid">
                <div class="piw-tw-stat" style="border-top:2px solid #34d399">
                    <div class="piw-tw-stat-title">✨ XP / HORA</div>
                    <div class="piw-tw-stat-val" style="color:#34d399">${expPerHour.toLocaleString('pt-BR')}</div>
                    <div class="piw-tw-stat-sub">Taxa horária estimada</div>
                </div>
                <div class="piw-tw-stat" style="border-top:2px solid #818cf8">
                    <div class="piw-tw-stat-title">⭐ XP TOTAL</div>
                    <div class="piw-tw-stat-val" style="color:#818cf8">+${huntSession.xp.toLocaleString('pt-BR')}</div>
                    <div class="piw-tw-stat-sub">XP ganha nesta sessão</div>
                </div>
                <div class="piw-tw-stat" style="border-top:2px solid #f59e0b">
                    <div class="piw-tw-stat-title">💰 LOOT / HORA</div>
                    <div class="piw-tw-stat-val" style="color:#f59e0b">$${lootPerHour.toLocaleString('pt-BR')}</div>
                    <div class="piw-tw-stat-sub">Taxa de farm estimada</div>
                </div>
                <div class="piw-tw-stat" style="border-top:2px solid #facc15">
                    <div class="piw-tw-stat-title">💎 LOOT TOTAL</div>
                    <div class="piw-tw-stat-val" style="color:#facc15">$${sessionLoot.toLocaleString('pt-BR')}</div>
                    <div class="piw-tw-stat-sub">${huntSession.drops.size} tipo(s) de itens</div>
                </div>
                <div class="piw-tw-stat" style="border-top:2px solid ${isNetPositive ? '#34d399' : '#f87171'}">
                    <div class="piw-tw-stat-title">📈 SALDO / HORA</div>
                    <div class="piw-tw-stat-val" style="color:${isNetPositive ? '#34d399' : '#f87171'}">${sign}$${Math.abs(netPerHour).toLocaleString('pt-BR')}</div>
                    <div class="piw-tw-stat-sub">${isNetPositive ? 'Lucro líquido/h' : 'Prejuízo líquido/h'}</div>
                </div>
                <div class="piw-tw-stat" style="border-top:2px solid ${isNetPositive ? '#4ade80' : '#f87171'}">
                    <div class="piw-tw-stat-title">💵 SALDO TOTAL</div>
                    <div class="piw-tw-stat-val" style="color:${isNetPositive ? '#4ade80' : '#f87171'}">${sign}$${absNet.toLocaleString('pt-BR')}</div>
                    <div class="piw-tw-stat-sub">Loot + Capturas - Supply</div>
                </div>
                <div class="piw-tw-stat" style="border-top:2px solid #f87171">
                    <div class="piw-tw-stat-title">🛒 SUPPLY GASTO</div>
                    <div class="piw-tw-stat-val" style="color:#f87171">-$${sessionSupply.toLocaleString('pt-BR')}</div>
                    <div class="piw-tw-stat-sub">${huntSession.balls} bolas${huntSession.potions > 0 ? ` · ${huntSession.potions} poções` : ''}</div>
                </div>
                <div class="piw-tw-stat" style="border-top:2px solid #60a5fa">
                    <div class="piw-tw-stat-title">🎯 PRÓX. NÍVEL</div>
                    <div class="piw-tw-stat-val" style="font-size:13px;color:#93c5fd;margin-top:3px">${etaVal}</div>
                    <div class="piw-tw-stat-sub">${etaSub}</div>
                </div>
            </div>

            <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 12px;display:flex;justify-content:space-between;margin-bottom:8px;font-size:11.5px;color:#e2e8f0">
                <span>⚔ Derrotados: <b style="color:#93c5fd">${huntSession.kills}</b> <span style="color:#cbd5e1;font-weight:600">(${killsPerHour}/h)</span></span>
                <span>🔴 Capturas: <b style="color:#86efac">${huntSession.caps}</b></span>
            </div>

            <div style="display:flex;gap:6px">
                <button id="piw-tw-save-btn" style="flex:2;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:8px;padding:8px;font-size:11.5px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(16,185,129,.3);transition:all .15s">💾 Salvar no Histórico</button>
                <button id="piw-tw-reset-btn" style="flex:1;background:linear-gradient(135deg,#ef4444,#dc2626);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;padding:8px;font-size:11.5px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(239,68,68,.3);transition:all .15s">↻ Resetar</button>
            </div>
        `;

        body.querySelector('#piw-tw-save-btn')?.addEventListener('click', () => saveCurrentRouteSession(true));
        body.querySelector('#piw-tw-reset-btn')?.addEventListener('click', () => {
            resetTrackerSession();
        });
    }

    // ========== JANELA DE LOGS DE CAPTURA ==========
    let capturesWindowVisible = GM_getValue('piw_caps_win_visible', false);
    let rawSavedLogs = GM_getValue('piw_capture_logs', []);
    let captureLogs = [];
    if (Array.isArray(rawSavedLogs)) {
        for (let i = 0; i < rawSavedLogs.length; i++) {
            const cur = rawSavedLogs[i];
            if (!cur || !cur.name) continue;
            const prev = captureLogs[captureLogs.length - 1];
            if (prev && prev.name === cur.name && Math.abs(Number(prev.time) - Number(cur.time)) < 2500) {
                if (!prev.quality && cur.quality) {
                    captureLogs[captureLogs.length - 1] = cur;
                }
                continue;
            }
            captureLogs.push(cur);
        }
        GM_setValue('piw_capture_logs', captureLogs);
    }
    let captureFilterShiny = false;
    let captureFilterQuality = 'all';
    let captureFilterQuery = '';

    function addCaptureLog(data) {
        if (!data) return;
        const name = cleanPokemonName(data.name || data.speciesName || '');
        if (!name) return;
        const c = creatures.find(cr => cr.name?.toLowerCase() === name.toLowerCase() || (cr.pokeId || cr.id) === Number(data.speciesId));
        const speciesId = data.speciesId || c?.pokeId || c?.id || 0;
        const isShiny = Boolean(data.shiny || /shiny|✨|★/i.test(data.name || ''));
        let val = Number(data.sellValue ?? data.priceNpc ?? data.price ?? data.value ?? 0);
        if (!val || val <= 0) val = Number(c?.sellValue ?? c?.priceNpc ?? 0);

        const entry = {
            id: String(data.id || ('cap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4))),
            speciesId: speciesId,
            name: name,
            level: Number(data.level || data.lvl || 1),
            shiny: isShiny,
            quality: data.quality != null ? Number(data.quality) : (data.q != null ? Number(data.q) : 1),
            ivTotal: data.ivTotal != null ? Number(data.ivTotal) : (data.ivs != null ? Number(data.ivs) : null),
            stats: data.stats || (data.hp ? { hp: data.hp, atk: data.atk, def: data.def, spAtk: data.spAtk || data.spatk, spDef: data.spDef || data.spdef, speed: data.speed || data.spe } : null),
            sellValue: val,
            ball: data.ball || null,
            route: currentRoute || huntingPokemon || (data.route ? formatHuntName(data.route) : 'Caça'),
            time: Date.now()
        };

        // Previne duplicações de qualquer evento dentro de 2.5 segundos (mesmo pokeId ou mesmo nome em intervalo curtíssimo)
        if (captureLogs.length > 0) {
            const first = captureLogs[0];
            const timeDiff = Math.abs(Date.now() - Number(first.time));
            if ((first.id === entry.id || first.name === entry.name) && timeDiff < 2500) {
                // Se a entrada nova tem dados de qualidade/IV e a anterior não tinha, enriquece a anterior
                if (!first.quality && entry.quality) {
                    captureLogs[0] = entry;
                    GM_setValue('piw_capture_logs', captureLogs);
                    if (capturesWindowVisible) renderCapturesWindow();
                    syncUI();
                }
                return;
            }
        }

        captureLogs.unshift(entry);
        if (captureLogs.length > 200) captureLogs.pop();
        GM_setValue('piw_capture_logs', captureLogs);

        if (capturesWindowVisible) renderCapturesWindow();
        syncUI();
    }

    function createCapturesWindowDOM() {
        if (document.getElementById('piw-captures-window')) return;

        const win = document.createElement('div');
        win.id = 'piw-captures-window';

        const storedPos = GM_getValue('piw_caps_win_pos', { left: 450, top: 180 });
        const storedSize = GM_getValue('piw_caps_win_size', null);
        const cwL = parseFloat(storedPos.left);
        const cwT = parseFloat(storedPos.top);
        win.style.left = `${!isNaN(cwL) ? cwL : 450}px`;
        win.style.top = `${!isNaN(cwT) ? cwT : 180}px`;
        if (storedSize && storedSize.w) win.style.width = `${storedSize.w}px`;
        if (storedSize && storedSize.h) win.style.height = `${storedSize.h}px`;
        win.style.display = capturesWindowVisible ? 'flex' : 'none';

        win.innerHTML = `
            <div class="piw-cw-head">
                <span class="piw-cw-title"><span class="piw-cw-dot"></span>📦 Log de Capturas</span>
                <span class="piw-cw-close" id="piw-cw-close-btn" title="Fechar">✕</span>
            </div>
            <div class="piw-cw-body"></div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;

        makeBringableToFront(win);
        document.body.appendChild(win);
        applyOpacityAll();

        win.querySelector('#piw-cw-close-btn').addEventListener('click', closeCapturesWindow);

        const head = win.querySelector('.piw-cw-head');
        makeDraggable(win, head, 'piw_caps_win_pos');

        const resizeHandle = win.querySelector('.piw-win-resize');
        makeResizable(win, resizeHandle, 'piw_caps_win_size', 360, 220);

        if (capturesWindowVisible) {
            renderCapturesWindow();
        }
    }

    function closeCapturesWindow() {
        capturesWindowVisible = false;
        GM_setValue('piw_caps_win_visible', false);
        const win = document.getElementById('piw-captures-window');
        if (win) win.style.display = 'none';
    }

    function toggleCapturesWindow() {
        let win = document.getElementById('piw-captures-window');
        if (!win) {
            createCapturesWindowDOM();
            win = document.getElementById('piw-captures-window');
        }
        if (!win) return;

        capturesWindowVisible = !capturesWindowVisible;
        GM_setValue('piw_caps_win_visible', capturesWindowVisible);
        win.style.display = capturesWindowVisible ? 'flex' : 'none';
        if (capturesWindowVisible) {
            bringToFront(win);
            renderCapturesWindow();
        }
    }

    function renderCapturesWindow() {
        const win = document.getElementById('piw-captures-window');
        if (!win || !capturesWindowVisible) return;

        const body = win.querySelector('.piw-cw-body');
        if (!body) return;

        const totalCaps = captureLogs.length;
        const totalShinies = captureLogs.filter(p => p.shiny).length;
        const totalGold = captureLogs.reduce((sum, p) => sum + (Number(p.sellValue) || 0), 0);

        let filtered = captureLogs;
        if (captureFilterShiny) {
            filtered = filtered.filter(p => p.shiny);
        }
        if (captureFilterQuality && captureFilterQuality !== 'all') {
            filtered = filtered.filter(p => {
                if (!p.quality) return captureFilterQuality === 'Fraca';
                const tier = getQualityTier(p.quality);
                return tier && tier.name.toLowerCase() === captureFilterQuality.toLowerCase();
            });
        }
        if (captureFilterQuery.trim()) {
            const q = captureFilterQuery.trim().toLowerCase();
            filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || (p.route && p.route.toLowerCase().includes(q)));
        }

        const formatTime = (ts) => {
            if (!ts) return '';
            const d = new Date(ts);
            const now = new Date();
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            const seconds = String(d.getSeconds()).padStart(2, '0');
            const timeStr = `${hours}:${minutes}:${seconds}`;

            if (d.toDateString() === now.toDateString()) {
                return `Hoje ${timeStr}`;
            }
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            return `${day}/${month} ${timeStr}`;
        };

        const renderItem = (p) => {
            const resolved = resolvePokemonSpecies(p.name, p.speciesId);
            const speciesId = resolved.speciesId;
            const sprites = getPokemonSpriteUrls(speciesId, p.shiny);
            const qTier = p.quality ? getQualityTier(p.quality) : null;
            const isCurrentlyInspected = inspectedPokemon && String(inspectedPokemon.id) === String(p.id);

            return `
                <div class="piw-cw-item ${p.shiny ? 'shiny' : ''}${isCurrentlyInspected ? ' inspected' : ''}" data-cap-id="${p.id}" style="cursor:pointer" title="Clique para ver os IVs & Stats">
                    <img class="piw-cw-sprite" src="${sprites ? sprites.still : ''}" alt="${p.name}" onerror="if(this.src!=='${sprites ? sprites.anim : ''}')this.src='${sprites ? sprites.anim : ''}'">
                    <div class="piw-cw-info">
                        <div class="piw-cw-name-row">
                            <span class="piw-cw-name">${p.name}</span>
                            <span class="piw-cw-lv">Nv ${p.level || 1}</span>
                            ${p.shiny ? '<span style="font-size:9.5px;font-weight:700;color:#000;background:linear-gradient(135deg,#fde047,#eab308);border-radius:4px;padding:1px 5px">SHINY</span>' : ''}
                        </div>
                        <div class="piw-cw-badges">
                            ${qTier ? `<span class="piw-cw-badge" style="color:${qTier.color};background:${qTier.color}22;border:1px solid ${qTier.color}88;font-weight:700">${qTier.name} (${p.quality})</span>` : (p.quality ? `<span class="piw-cw-badge" style="color:#cbd5e1;border:1px solid rgba(255,255,255,.2)">Q ${p.quality}</span>` : '')}
                            ${p.ivTotal ? `<span class="piw-cw-badge" style="color:#60a5fa;border:1px solid rgba(96,165,250,.3)">IV ${p.ivTotal}</span>` : ''}
                        </div>
                    </div>
                    <div class="piw-cw-meta">
                        <div class="piw-cw-val">+$${(Number(p.sellValue) || 0).toLocaleString('pt-BR')}</div>
                        <div class="piw-cw-time">${formatTime(p.time)}</div>
                    </div>
                </div>
            `;
        };

        const qualTiersList = [
            { id: 'all', name: 'Todas', color: '#cbd5e1' },
            { id: 'Fraca', name: 'Fraca', color: '#94a3b8' },
            { id: 'Comum', name: 'Comum', color: '#22c55e' },
            { id: 'Incomum', name: 'Incomum', color: '#38bdf8' },
            { id: 'Rara', name: 'Rara', color: '#a855f7' },
            { id: 'Épica', name: 'Épica', color: '#facc15' },
            { id: 'Lendária', name: 'Lendária', color: '#f97316' },
            { id: 'Mítica', name: 'Mítica', color: '#ec4899' },
            { id: 'Antiga', name: 'Antiga', color: '#d97706' },
            { id: 'Divina', name: 'Divina', color: '#e0f2fe' }
        ];

        const qualPillsHtml = qualTiersList.map(t => {
            const isActive = captureFilterQuality === t.id;
            return `
                <span class="piw-cw-qual-pill ${isActive ? 'active' : ''}" data-qual="${t.id}" style="color:${t.color};border-color:${isActive ? t.color : t.color + '44'};background:${isActive ? t.color + '26' : 'rgba(255,255,255,.03)'}">
                    ${t.name}
                </span>
            `;
        }).join('');

        let itemsHtml = '';
        if (filtered.length === 0) {
            itemsHtml = `
                <div style="color:#cbd5e1;padding:24px 12px;text-align:center;font-size:11.5px;line-height:1.4">
                    ${captureLogs.length === 0
                        ? 'Nenhum pokémon capturado ainda nesta sessão.<br>Deixe o Auto Hunt rodando — cada captura aparecerá aqui automaticamente com todos os seus dados!'
                        : 'Nenhum pokémon encontrado para o filtro atual.'}
                </div>
            `;
        } else {
            itemsHtml = filtered.map(renderItem).join('');
        }

        body.innerHTML = `
            <div class="piw-cw-grid">
                <div class="piw-cw-stat">
                    <div class="piw-cw-stat-title">TOTAL</div>
                    <div class="piw-cw-stat-val" style="color:#93c5fd">${totalCaps}</div>
                </div>
                <div class="piw-cw-stat">
                    <div class="piw-cw-stat-title">SHINY ✨</div>
                    <div class="piw-cw-stat-val" style="color:#fde047">${totalShinies}</div>
                </div>
                <div class="piw-cw-stat">
                    <div class="piw-cw-stat-title">VALOR 💰</div>
                    <div class="piw-cw-stat-val" style="color:#4ade80">$${totalGold.toLocaleString('pt-BR')}</div>
                </div>
            </div>

            <div class="piw-cw-toolbar">
                <input type="text" class="piw-cw-search" id="piw-cw-search-input" placeholder="🔎 Filtrar por nome/rota..." value="${captureFilterQuery}">
                <button class="piw-cw-btn ${captureFilterShiny ? 'active' : ''}" id="piw-cw-filter-shiny" title="Exibir apenas Shiny">✨ Shiny</button>
                <button class="piw-cw-btn" id="piw-cw-clear-btn" title="Limpar histórico de capturas" style="color:#f87171">🗑 Limpar</button>
            </div>

            <div class="piw-cw-qual-bar">
                ${qualPillsHtml}
            </div>

            <div class="piw-cw-list">
                ${itemsHtml}
            </div>
        `;

        body.querySelectorAll('.piw-cw-qual-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const qId = pill.dataset.qual;
                if (captureFilterQuality !== qId) {
                    captureFilterQuality = qId;
                    renderCapturesWindow();
                }
            });
        });

        // Clique no card de captura para inspecionar IVs & Stats
        body.querySelectorAll('.piw-cw-item').forEach(itemEl => {
            const capId = itemEl.dataset.capId;
            const capMon = captureLogs.find(p => String(p.id) === String(capId));
            if (!capMon) return;

            itemEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (inspectedPokemon && String(inspectedPokemon.id) === String(capMon.id)) {
                    // Desmarca o Pokémon inspecionado e volta para o líder
                    inspectedPokemon = null;
                    isPartySlotPinned = false;
                } else {
                    inspectedPokemon = capMon;
                    isPartySlotPinned = true;
                    if (!infoWindowVisible) {
                        toggleInfoWindow();
                    } else {
                        const win = document.getElementById('piw-info-window');
                        if (win) bringToFront(win);
                    }
                }
                renderCapturesWindow();
                if (infoWindowVisible) renderInfoWindow();
            });
        });

        const searchInput = body.querySelector('#piw-cw-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                captureFilterQuery = e.target.value;
                renderCapturesWindow();
                const reFocused = body.querySelector('#piw-cw-search-input');
                if (reFocused) {
                    reFocused.focus();
                    reFocused.selectionStart = reFocused.selectionEnd = reFocused.value.length;
                }
            });
        }

        body.querySelector('#piw-cw-filter-shiny')?.addEventListener('click', () => {
            captureFilterShiny = !captureFilterShiny;
            renderCapturesWindow();
        });

        body.querySelector('#piw-cw-clear-btn')?.addEventListener('click', () => {
            if (captureLogs.length > 0 && confirm('Deseja limpar todo o histórico de capturas?')) {
                captureLogs = [];
                GM_setValue('piw_capture_logs', captureLogs);
                renderCapturesWindow();
                syncUI();
            }
        });
    }



    // ========== POKEMON SELECTOR ==========
    function renderSelectedTags() {
        const container = document.getElementById('piw-selected-tags');
        const hint = document.getElementById('piw-hint');
        if (!container) return;
        container.innerHTML = selectedPokemon.map((name, idx) =>
            `<span class="piw-tag" draggable="true" data-idx="${idx}" style="cursor:grab">${name} <span class="piw-tag-remove" draggable="false" data-name="${name}">&times;</span></span>`
        ).join('');
        if (hint) {
            hint.textContent = selectedPokemon.length === 0
                ? 'Nenhum selecionado'
                : `${selectedPokemon.length} selecionado(s)`;
        }
        // Event listeners para remover
        container.querySelectorAll('.piw-tag-remove').forEach(btn => {
            const stopDrag = (e) => {
                e.stopPropagation();
                const parentTag = btn.closest('.piw-tag');
                if (parentTag) parentTag.setAttribute('draggable', 'false');
            };
            const restoreDrag = (e) => {
                e.stopPropagation();
                const parentTag = btn.closest('.piw-tag');
                if (parentTag) parentTag.setAttribute('draggable', 'true');
            };
            btn.addEventListener('mousedown', stopDrag);
            btn.addEventListener('pointerdown', stopDrag);
            btn.addEventListener('mouseup', restoreDrag);
            btn.addEventListener('mouseleave', restoreDrag);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedPokemon = selectedPokemon.filter(n => n !== btn.dataset.name);
                GM_setValue('piw_selectedPokemon', selectedPokemon);
                renderSelectedTags();
            });
        });
        // Drag and drop pra reordenar
        let dragIdx = null;
        container.querySelectorAll('.piw-tag').forEach(tag => {
            tag.addEventListener('dragstart', (e) => {
                if (e.target.closest('.piw-tag-remove')) {
                    e.preventDefault();
                    return false;
                }
                dragIdx = parseInt(tag.dataset.idx);
                tag.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            });
            tag.addEventListener('dragend', () => {
                tag.style.opacity = '1';
                dragIdx = null;
                container.querySelectorAll('.piw-tag').forEach(t => { t.style.borderTop = ''; t.style.boxShadow = ''; });
            });
            tag.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                tag.style.borderTop = '2px solid #5b7fff';
                tag.style.boxShadow = '0 -2px 8px rgba(91,127,255,.4)';
            });
            tag.addEventListener('dragleave', () => {
                tag.style.borderTop = '';
                tag.style.boxShadow = '';
            });
            tag.addEventListener('drop', (e) => {
                e.preventDefault();
                tag.style.borderTop = '';
                const dropIdx = parseInt(tag.dataset.idx);
                if (dragIdx !== null && dragIdx !== dropIdx) {
                    const item = selectedPokemon.splice(dragIdx, 1)[0];
                    selectedPokemon.splice(dropIdx, 0, item);
                    GM_setValue('piw_selectedPokemon', selectedPokemon);
                    renderSelectedTags();
                }
            });
        });
    }

    // Set de IDs de lendários/míticos/não-capturáveis que não possuem rota de caça no mapa
    const NON_HUNTABLE_SPECIES_IDS = new Set([
        144, 145, 146, 150, 151, // Articuno, Zapdos, Moltres, Mewtwo, Mew
        243, 244, 245, 249, 250, 251, // Raikou, Entei, Suicune, Lugia, Ho-Oh, Celebi
        377, 378, 379, 380, 381, 382, 383, 384, 385, 386, // Regis, Latios/as, Weather, Jirachi, Deoxys
        480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, // Gen 4 Legendaries/Mythicals
        638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, // Gen 5 Legendaries
        716, 717, 718, 719, 720, 721, // Gen 6 Legendaries
        785, 786, 787, 788, 789, 790, 791, 792, 800, 801, 802, 807, 808, 809 // Gen 7 Legendaries
    ]);

    function getFilteredPokemonList(filter) {
        scanDOMRoutes();
        const NAME_MAP = {
            'nidoranfe': 'Nidoran Female',
            'nidoranma': 'Nidoran Male',
            'farfetchd': 'Farfetchd',
            'farfetch': 'Farfetchd',
            'mrmime': 'Mr. Mime',
            'hooh': 'Ho-oh',
        };
        const pokemonMap = new Map();

        const getNormalizedKey = (name) => {
            if (!name) return '';
            const rawKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const mapped = NAME_MAP[rawKey] || name;
            return mapped.toLowerCase().replace(/[^a-z0-9]/g, '');
        };

        // Popula APENAS com Pokémons que possuem rota/marcador de hunt no mapa (Kanto / Outland)
        routes.forEach(r => {
            if (!r.name) return;
            const key = getNormalizedKey(r.name);
            if (CITY_SLUGS.has(key)) return;

            const creature = creatures.find(c => getNormalizedKey(c.name) === key);
            const rawKey = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const correctName = creature?.name || NAME_MAP[rawKey] || r.name;
            const pokeId = creature?.pokeId || creature?.id || 0;

            if (NON_HUNTABLE_SPECIES_IDS.has(pokeId) && !r.isExplicitRoute) return;

            pokemonMap.set(key, {
                name: correctName,
                level: r.level || 1,
                pokeId: pokeId,
                type1: creature?.type1 || '',
                type2: creature?.type2 || '',
                area: r.area || 'map'
            });
        });

        for (const city of CITY_SLUGS) pokemonMap.delete(city);

        let pokemonArray = [...pokemonMap.values()];
        if (filterWeakOnly && leaderTypes.length > 0) {
            pokemonArray = pokemonArray.filter(p => isWeakAgainstLeader(p.name, leaderTypes));
        }
        if (filterShinyAvail && shinyAvailable.size > 0) {
            pokemonArray = pokemonArray.filter(p => shinyAvailable.has(p.name.toLowerCase()));
        }
        if (filter) {
            const f = filter.toLowerCase();
            pokemonArray = pokemonArray.filter(p => p.name.toLowerCase().includes(f) || String(p.pokeId).includes(f));
        }
        pokemonArray.sort((a, b) => a.pokeId - b.pokeId || a.level - b.level);
        return pokemonArray;
    }

    // ========== POKEDEX MODAL ==========
    let pokedexModalFilter = '';
    let pokedexModalTypeFilter = '';
    let pokedexModalShinyOnly = false;
    let pokedexModalWeakOnly = false;
    let pokedexSortOrder = 'id_asc';

    function getPokemonImageUrl(pokeId, name, animated = false) {
        let pId = Number(pokeId) || 0;

        if (pId <= 0 || pId >= 10000) {
            const rawName = String(name || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
            if (rawName && Array.isArray(creatures) && creatures.length > 0) {
                // 1. Busca exata
                const exact = creatures.find(cr => cr.name?.toLowerCase() === rawName);
                if (exact && exact.pokeId > 0 && exact.pokeId < 10000) {
                    pId = exact.pokeId;
                } else {
                    // 2. Remove prefixos custom (Ancient, Shiny, Shadow, Mega, Delta, etc.)
                    const baseName = rawName.replace(/^(ancient|shiny|shadow|dark|corrupted|primal|mega|armored|giant|alolan|galarian|hisuian|paldean|delta|crystal|golden|boss|elite)\s+/i, '').trim();
                    const matchBase = creatures.find(cr => cr.name?.toLowerCase() === baseName);
                    if (matchBase && matchBase.pokeId > 0 && matchBase.pokeId < 10000) {
                        pId = matchBase.pokeId;
                    } else {
                        // 3. Busca por palavra contida
                        let bestMatch = null;
                        for (const c of creatures) {
                            if (!c.name || c.pokeId >= 10000) continue;
                            const cName = c.name.toLowerCase();
                            if (rawName.includes(cName) || cName.includes(rawName)) {
                                if (!bestMatch || c.name.length > bestMatch.name.length) {
                                    bestMatch = c;
                                }
                            }
                        }
                        if (bestMatch && bestMatch.pokeId > 0 && bestMatch.pokeId < 10000) {
                            pId = bestMatch.pokeId;
                        }
                    }
                }
            }
        }

        if (pId > 0 && pId < 10000) {
            if (animated && pId <= 649) {
                return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${pId}.gif`;
            }
            return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pId}.png`;
        }
        return '';
    }

    function openPokedexModal() {
        if (document.getElementById('piw-pokedex-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'piw-pokedex-overlay';
        overlay.className = 'piw-modal-overlay';
        overlay.innerHTML = `
            <div class="piw-modal">
                <div class="piw-modal-header">
                    <h3>Selecionar Pokémon</h3>
                    <button class="piw-modal-close" id="piw-pokedex-close">&times;</button>
                </div>
                <div class="piw-modal-toolbar">
                    <input type="text" id="piw-pokedex-search" placeholder="Buscar por nome ou número..." value="${pokedexModalFilter}">
                    <select id="piw-pokedex-type-filter">
                        <option value="">Todos os tipos</option>
                        ${Object.keys(TYPE_COLORS).map(t => ({ key: t, label: getTypeLabelPT(t) })).sort((a, b) => a.label.localeCompare(b.label, 'pt')).map(item => `<option value="${item.key}" ${pokedexModalTypeFilter===item.key?'selected':''}>${item.label}</option>`).join('')}
                    </select>
                    <select id="piw-pokedex-sort">
                        <option value="id_asc" ${pokedexSortOrder==='id_asc'?'selected':''}>Número (# ID)</option>
                        <option value="name_asc" ${pokedexSortOrder==='name_asc'?'selected':''}>Nome (A-Z)</option>
                        <option value="level_asc" ${pokedexSortOrder==='level_asc'?'selected':''}>Nível (Crescente)</option>
                        <option value="level_desc" ${pokedexSortOrder==='level_desc'?'selected':''}>Nível (Decrescente)</option>
                    </select>
                    <label class="piw-check"><input type="checkbox" id="piw-pokedex-shiny" ${pokedexModalShinyOnly?'checked':''}> Shiny</label>
                    <label class="piw-check"><input type="checkbox" id="piw-pokedex-weak" ${pokedexModalWeakOnly?'checked':''}> Fraco contra líder</label>
                    <span class="piw-modal-count" id="piw-pokedex-count"></span>
                </div>
                <div id="piw-type-hint" style="display:none;padding:8px 20px;font-size:12px;border-bottom:1px solid #1e2433"></div>
                <div class="piw-modal-body">
                    <div class="piw-pokedex-grid" id="piw-pokedex-grid"></div>
                </div>
                <div class="piw-modal-footer">
                    <div class="piw-btns-row">
                        <button class="piw-btn" id="piw-pokedex-select-all">Selecionar todos</button>
                        <button class="piw-btn" id="piw-pokedex-clear-all">Limpar tudo</button>
                    </div>
                    <span class="piw-selected-info" id="piw-pokedex-selected-info"></span>
                    <button class="piw-btn piw-btn-apply" id="piw-pokedex-apply">Aplicar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const modal = overlay.querySelector('.piw-modal');
        const modalHeader = modal.querySelector('.piw-modal-header');

        bringToFront(overlay);
        makeBringableToFront(overlay);
        makeBringableToFront(modal);
        applyOpacityAll();

        const savedModalSize = GM_getValue('piw_modalSize', null);
        if (savedModalSize && savedModalSize.w && savedModalSize.h) {
            modal.style.width  = savedModalSize.w + 'px';
            modal.style.height = savedModalSize.h + 'px';
        }
        const savedModalPos = GM_getValue('piw_modalPos', null);
        if (savedModalPos) {
            const mpl = parseFloat(savedModalPos.left);
            const mpt = parseFloat(savedModalPos.top);
            if (!isNaN(mpl)) { modal.style.left = mpl + 'px'; modal.style.right = 'auto'; }
            if (!isNaN(mpt)) { modal.style.top  = mpt + 'px'; modal.style.bottom = 'auto'; }
        } else if (savedModalSize && savedModalSize.w && savedModalSize.h) {
            // Centraliza baseado no tamanho salvo se não houver posição salva
            modal.style.left = `calc(50vw - ${savedModalSize.w / 2}px)`;
            modal.style.top  = `calc(50vh - ${savedModalSize.h / 2}px)`;
        }

        makeDraggable(modal, modalHeader, 'piw_modalPos');

        const modalResize = document.createElement('div');
        modalResize.className = 'piw-modal-resize';
        modal.appendChild(modalResize);
        makeResizable(modal, modalResize, 'piw_modalSize', 500, 400);

        const grid = document.getElementById('piw-pokedex-grid');
        const searchInput = document.getElementById('piw-pokedex-search');
        const typeFilter = document.getElementById('piw-pokedex-type-filter');
        const sortSelect = document.getElementById('piw-pokedex-sort');
        const shinyCheck = document.getElementById('piw-pokedex-shiny');
        const countEl = document.getElementById('piw-pokedex-count');
        const infoEl = document.getElementById('piw-pokedex-selected-info');

        modal.style.opacity = panel.style.opacity;

        let tempSelected = [...selectedPokemon];

        function renderPokedex() {
            const filter = searchInput.value.toLowerCase();
            const typeF = typeFilter.value;
            const shinyOnly = shinyCheck.checked;

            let pokemonArray = getFilteredPokemonList('');

            if (filter) {
                pokemonArray = pokemonArray.filter(p =>
                    p.name.toLowerCase().includes(filter) || String(p.pokeId).includes(filter)
                );
            }
            if (typeF) {
                pokemonArray = pokemonArray.filter(p => p.type1 === typeF || p.type2 === typeF);
            }
            if (shinyOnly) {
                pokemonArray = pokemonArray.filter(p => shinyAvailable.has(p.name.toLowerCase()));
            }
            if (pokedexModalWeakOnly && leaderTypes.length > 0) {
                pokemonArray = pokemonArray.filter(p => isWeakAgainstLeader(p.name, leaderTypes));
            }

            const sortMode = sortSelect ? sortSelect.value : pokedexSortOrder;
            if (sortMode === 'level_asc') {
                pokemonArray.sort((a, b) => (a.level - b.level) || (a.pokeId - b.pokeId));
            } else if (sortMode === 'level_desc') {
                pokemonArray.sort((a, b) => (b.level - a.level) || (a.pokeId - b.pokeId));
            } else if (sortMode === 'id_asc') {
                pokemonArray.sort((a, b) => a.pokeId - b.pokeId);
            } else if (sortMode === 'name_asc') {
                pokemonArray.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
            }

            countEl.textContent = `${pokemonArray.length} pokemon(s)`;

            grid.innerHTML = pokemonArray.map(p => {
                const sel = tempSelected.includes(p.name);
                const img = getPokemonImageUrl(p.pokeId, p.name);
                const canShiny = shinyAvailable.has(p.name.toLowerCase());
                const types = [p.type1, p.type2].filter(Boolean);
                return `<div class="piw-poke-card${sel?' selected':''}" data-name="${p.name}">
                    <div class="piw-poke-check">✓</div>
                    ${canShiny ? '<div class="piw-poke-shiny">✨</div>' : ''}
                    <img class="piw-poke-img" src="${img}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'">
                    <div class="piw-poke-num">#${String(p.pokeId).padStart(3,'0')}</div>
                    <div class="piw-poke-name" title="${p.name}">${p.name}</div>
                    <div class="piw-poke-level">Lv.${p.level}</div>
                    <div class="piw-poke-types">
                        ${types.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS_MAP[t.toLowerCase()]||TYPE_COLORS[t]||'#888'};font-weight:700">${getTypeLabelPT(t)}</span>`).join('')}
                    </div>
                </div>`;
            }).join('');

            infoEl.textContent = `${tempSelected.length} selecionado(s)`;

            grid.querySelectorAll('.piw-poke-card').forEach(card => {
                card.addEventListener('click', () => {
                    const name = card.dataset.name;
                    if (tempSelected.includes(name)) {
                        tempSelected = tempSelected.filter(n => n !== name);
                    } else {
                        tempSelected.push(name);
                    }
                    card.classList.toggle('selected');
                    infoEl.textContent = `${tempSelected.length} selecionado(s)`;
                });
            });
        }

        searchInput.addEventListener('input', () => { pokedexModalFilter = searchInput.value; renderPokedex(); });
        typeFilter.addEventListener('change', () => {
            pokedexModalTypeFilter = typeFilter.value;
            renderPokedex();
            const hintEl = document.getElementById('piw-type-hint');
            if (hintEl) {
                if (typeFilter.value) {
                    const weakTo = TYPE_WEAK_TO[typeFilter.value] || [];
                    const superEff = TYPE_SUPER_EFFECTIVE[typeFilter.value] || [];
                    let html = `<span style="color:#f87171;font-weight:600">⚔ Fraco contra:</span> `;
                    html += weakTo.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS_MAP[t.toLowerCase()]||TYPE_COLORS[t]||'#555'};font-weight:700">${getTypeLabelPT(t)}</span>`).join(' ');
                    html += `<br><span style="color:#4ade80;font-weight:600">🛡 Resistente a:</span> `;
                    html += superEff.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS_MAP[t.toLowerCase()]||TYPE_COLORS[t]||'#555'};font-weight:700">${getTypeLabelPT(t)}</span>`).join(' ');
                    hintEl.innerHTML = html;
                    hintEl.style.display = 'block';
                } else {
                    hintEl.style.display = 'none';
                }
            }
        });
        shinyCheck.addEventListener('change', () => { pokedexModalShinyOnly = shinyCheck.checked; renderPokedex(); });
        sortSelect.addEventListener('change', () => { pokedexSortOrder = sortSelect.value; renderPokedex(); });
        const weakCheck = document.getElementById('piw-pokedex-weak');
        weakCheck.addEventListener('change', () => { pokedexModalWeakOnly = weakCheck.checked; renderPokedex(); });

        document.getElementById('piw-pokedex-select-all').addEventListener('click', () => {
            const filter = searchInput.value.toLowerCase();
            const typeF = typeFilter.value;
            const shinyOnly = shinyCheck.checked;
            let list = getFilteredPokemonList('');
            if (filter) list = list.filter(p => p.name.toLowerCase().includes(filter) || String(p.pokeId).includes(filter));
            if (typeF) list = list.filter(p => p.type1 === typeF || p.type2 === typeF);
            if (shinyOnly) list = list.filter(p => shinyAvailable.has(p.name.toLowerCase()));
            if (pokedexModalWeakOnly && leaderTypes.length > 0) list = list.filter(p => isWeakAgainstLeader(p.name, leaderTypes));
            tempSelected = [...new Set([...tempSelected, ...list.map(p => p.name)])];
            renderPokedex();
        });

        document.getElementById('piw-pokedex-clear-all').addEventListener('click', () => {
            tempSelected = [];
            renderPokedex();
        });

        document.getElementById('piw-pokedex-apply').addEventListener('click', () => {
            selectedPokemon = [...tempSelected];
            GM_setValue('piw_selectedPokemon', selectedPokemon);
            renderSelectedTags();
            pokedexModalTypeFilter = '';
            pokedexModalFilter = '';
            pokedexModalWeakOnly = false;
            overlay.remove();
        });

        document.getElementById('piw-pokedex-close').addEventListener('click', () => { pokedexModalTypeFilter = ''; pokedexModalFilter = ''; pokedexModalWeakOnly = false; overlay.remove(); });

        renderPokedex();
    }

    // Marca pokémons que têm shiny usando a tabela fixa
    function markShinyAvailable() {
        for (const c of creatures) {
            if (SHINY_SPECIES_IDS.has(c.pokeId)) {
                shinyAvailable.add(c.name.toLowerCase());
            }
        }
        GM_log('[AutoHunt] ✨ Shiny disponíveis:', shinyAvailable.size);
    }

    // ========== BUSCAR DADOS DO JOGO ==========
    async function fetchGameData() {
        try {
            // Busca creatures.json
            const creaturesResp = await fetch('/game/creatures.json');
            if (creaturesResp.ok) {
                const data = await creaturesResp.json();
                creatures = data.creatures || [];
                GM_log('[AutoHunt] Creatures carregados:', creatures.length);
                // Marca shiny disponíveis após carregar creatures
                markShinyAvailable();
            }
        } catch(e) {
            GM_log('[AutoHunt] Erro ao buscar creatures.json:', e);
        }

        // Busca rotas de múltiplos endpoints do mapa (Kanto, Outland, etc.)
        const mapEndpoints = [
            '/api/game/map-markers',
            '/api/game/outland-markers',
            '/api/game/outland',
            '/api/game/outlands',
            '/api/game/map-markers?area=outland',
            '/game/outland.json',
            '/game/hunts.json'
        ];

        const seenSlugs = new Set(routes.map(r => r.slug || r.name));

        for (const ep of mapEndpoints) {
            try {
                const markersResp = await fetch(ep);
                if (markersResp.ok) {
                    const data = await markersResp.json();
                    let rawHunts = [];
                    if (Array.isArray(data)) {
                        rawHunts = data;
                    } else if (typeof data === 'object' && data !== null) {
                        for (const [key, val] of Object.entries(data)) {
                            if (Array.isArray(val)) {
                                const isOutlandKey = key.toLowerCase().includes('outland') || ep.includes('outland');
                                val.forEach(item => {
                                    if (item && typeof item === 'object') {
                                        rawHunts.push({
                                            ...item,
                                            area: item.area || (isOutlandKey ? 'outland' : undefined)
                                        });
                                    }
                                });
                            }
                        }
                    }
                    for (const h of rawHunts) {
                        if (h && h.name && h.slug !== 'cerulean') {
                            const key = (h.slug || h.name).toLowerCase().replace(/[^a-z0-9]/g, '');
                            if (!seenSlugs.has(key)) {
                                seenSlugs.add(key);
                                routes.push(h);
                            }
                        }
                    }
                }
            } catch(e) {}
        }
        GM_log('[AutoHunt] Rotas totais (incluindo Outland) carregadas:', routes.length);
    }

    // Escaneia marcadores de rotas/outland direto do DOM do jogo
    function scanDOMRoutes() {
        const markers = document.querySelectorAll('button.hunt-marker');
        let added = 0;
        for (const m of markers) {
            const nameEl = m.querySelector('.hunt-name');
            const lvEl = m.querySelector('.hunt-lv, .hunt-level, [class*="lv"], [class*="level"]');
            if (nameEl) {
                const name = nameEl.textContent.trim();
                if (name && name !== 'Cerulean') {
                    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (!routes.some(r => r.name?.toLowerCase() === name.toLowerCase())) {
                        const lvMatch = (lvEl?.textContent || '').match(/\d+/);
                        const isOutland = document.querySelector('button.map-area.active')?.textContent?.toLowerCase().includes('outland') || false;
                        routes.push({
                            name: name,
                            slug: key,
                            level: lvMatch ? Number(lvMatch[0]) : 1,
                            area: isOutland ? 'outland' : undefined
                        });
                        added++;
                    }
                }
            }
        }
        if (added > 0) {
            GM_log('[AutoHunt] Novas rotas/Outland detectadas via DOM:', added);
        }
    }

    // ========== DETECTAR ROTA ATUAL ==========
    function detectRoute() {
        scanDOMRoutes();
        // Procura no DOM elementos que contenham o nome da rota
        const candidates = document.querySelectorAll(
            '[class*="route"] a, [class*="location"], [class*="area"], .piw-route-src'
        );
        for (const el of candidates) {
            const t = (el.textContent || '').trim();
            if (t && t.length < 40 && !/loading/i.test(t) && !/menu/i.test(t)) {
                const newRoute = t.split('(')[0].trim();
                if (newRoute && newRoute !== currentRoute) {
                    currentRoute = newRoute;
                    resetObservedMoves();
                }
                return currentRoute;
            }
        }
        // Detecta cidade pelo mapa se slug não foi setado pelo WebSocket
        if (!currentSlug) {
            const mapMarkers = document.querySelectorAll('.map-marker, .city-marker, button[data-city]');
            for (const m of mapMarkers) {
                const citySlug = m.getAttribute('data-city') || (m.textContent || '').trim().toLowerCase();
                if (CITY_SLUGS.has(citySlug)) {
                    currentSlug = citySlug;
                    GM_log('[AutoHunt] Cidade detectada via DOM:', citySlug);
                    syncUI();
                    return currentRoute;
                }
            }
            // Checa se URL/estado indica cidade
            if (window.location.hash && /city|town|village/.test(window.location.hash)) {
                for (const city of CITY_SLUGS) {
                    if (window.location.hash.toLowerCase().includes(city)) {
                        currentSlug = city;
                        GM_log('[AutoHunt] Cidade detectada via URL:', city);
                        syncUI();
                        return currentRoute;
                    }
                }
            }
        }
        // Fallback: tenta ler do estado do React (se exposto)
        if (window.__gameState?.currentRoute) {
            currentRoute = window.__gameState.currentRoute;
        }
        return currentRoute;
    }

    // ========== OUVIR EVENTO PW-KILL ==========
    window.addEventListener('pw-kill', () => {
        trackerSessionKills++;
        trackerSessionBalls++;
        if (trackerSessionSupply === 0) {
            trackerSessionSupply = trackerSessionBalls * 100;
        } else {
            trackerSessionSupply += 100;
        }
        if (!enabled || isCity() || busy) return;
        killCount++;
        GM_log('[AutoHunt] Kill! Total:', killCount);
        const killTgt = GM_getValue('piw_killTarget', 100);
        const capTgt = GM_getValue('piw_captureTarget', 1);
        if (currentSlug) {
            const slugLower = currentSlug.toLowerCase();
            const matchIdx = selectedPokemon.findIndex(n => n.toLowerCase().replace(/\s+/g, '-') === slugLower || n.toLowerCase() === slugLower);
            if (matchIdx !== -1) {
                const killKey = 'piw_kills_' + slugLower;
                const prev = GM_getValue(killKey, 0);
                GM_setValue(killKey, prev + 1);
                const capKey = 'piw_captures_' + slugLower;
                const totalCaps = GM_getValue(capKey, 0);
                if ((prev + 1) >= killTgt && totalCaps >= capTgt) {
                    if (!loopMode) {
                        selectedPokemon.splice(matchIdx, 1);
                        GM_setValue('piw_selectedPokemon', selectedPokemon);
                        renderSelectedTags();
                        GM_log('[AutoHunt] ' + slugLower + ' atingiu os 2 alvos! Removido.');
                    } else {
                        GM_log('[AutoHunt] ' + slugLower + ' atingiu os 2 alvos! (loop ativo, mantido na lista)');
                    }
                }
            }
        }
        syncUI();
        checkSwitch();
    });

    // ========== CHECK SWITCH ==========
    function checkSwitch() {
        if (isCity()) return;
        const killTarget = GM_getValue('piw_killTarget', 100);
        const capTarget = GM_getValue('piw_captureTarget', 1);
        let shouldSwitch = false;
        if (exitOnKills && exitOnCaptures) {
            shouldSwitch = (killCount >= killTarget || captureCount >= capTarget);
        } else if (exitOnKills) {
            shouldSwitch = (killCount >= killTarget);
        } else if (exitOnCaptures) {
            shouldSwitch = (captureCount >= capTarget);
        } else {
            shouldSwitch = (killCount >= killTarget && captureCount >= capTarget);
        }
        if (shouldSwitch && !busy) {
            doSwitch();
        }
    }

    function attachReopenBtnToDock() {
        const reopenBtn = document.getElementById('piw-reopen');
        if (!reopenBtn) return false;
        const sampleDockBtn = document.querySelector('button.dock-btn, .dock-btn, [class*="dock-btn"]');
        if (sampleDockBtn && sampleDockBtn.parentElement) {
            const dockContainer = sampleDockBtn.parentElement;
            if (reopenBtn.parentElement !== dockContainer) {
                if (dockContainer.firstChild) {
                    dockContainer.insertBefore(reopenBtn, dockContainer.firstChild);
                } else {
                    dockContainer.appendChild(reopenBtn);
                }
                reopenBtn.classList.add('dock-btn', 'piw-dock-mode');
            }
            try {
                const sampleStyle = window.getComputedStyle(sampleDockBtn);
                if (sampleStyle) {
                    const parsedW = parseFloat(sampleStyle.width);
                    const parsedH = parseFloat(sampleStyle.height);
                    if (!isNaN(parsedW) && parsedW >= 24) reopenBtn.style.width = sampleStyle.width;
                    if (!isNaN(parsedH) && parsedH >= 24) reopenBtn.style.height = sampleStyle.height;
                    if (sampleStyle.margin && sampleStyle.margin !== '0px') reopenBtn.style.margin = sampleStyle.margin;
                    if (sampleStyle.borderRadius) reopenBtn.style.borderRadius = sampleStyle.borderRadius;
                }
            } catch(e) {}
            reopenBtn.style.visibility = 'visible';
            return true;
        }
        return false;
    }

    // Polling contínuo para manter o botão sempre anexado ao dock do jogo
    setInterval(attachReopenBtnToDock, 500);

    // Polling regular para detectar rota e manter UI sincronizada
    setInterval(() => { detectRoute(); onRouteOrHuntChange(currentSlug); attachReopenBtnToDock(); persistHuntSession(); syncUI(); }, 2000);

    // ========== PROCESSADOR CENTRAL DE MENSAGENS DO JOGO (100% AUTÔNOMO) ==========
    let lastProcessedMsgStr = '';
    let lastProcessedMsgTime = 0;

    function processIncomingWsMessage(source, rawData) {
        if (!rawData) return;
        const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
        const now = Date.now();
        if (rawStr === lastProcessedMsgStr && (now - lastProcessedMsgTime) < 400) {
            return; // DEDUPLICAÇÃO: evita que o mesmo evento seja processado múltiplas vezes
        }
        lastProcessedMsgStr = rawStr;
        lastProcessedMsgTime = now;

        let data = rawData;
        if (typeof rawData === 'string') {
            try { data = JSON.parse(rawData); } catch(e) { return; }
        }
        if (!data || typeof data !== 'object') return;

        // 0. Carregamento de lista de Pokémons do Jogador (evita contar XP/level-up do próprio time como captura)
        if (data.type === 'pokes' && Array.isArray(data.list)) {
            for (const p of data.list) {
                if (p && p.id != null) knownPlayerPokeIds.add(String(p.id));
            }
            initialPokesLoaded = true;
        }
        if ((data.type === 'party' || data.type === 'team') && Array.isArray(data.list)) {
            for (const p of data.list) {
                if (p && p.id != null) knownPlayerPokeIds.add(String(p.id));
            }
        }

        // 0.1. Mudança de rota via API HTTP
        if (typeof source === 'string' && source.includes('/api/game/hunt-config')) {
            const match = /[?&]slug=([^&]+)/.exec(source);
            const slug = match ? decodeURIComponent(match[1]) : null;
            if (slug) onRouteOrHuntChange(slug);
        }

        // 0.2. Preços de Shop / Loja
        if (typeof source === 'string' && source.includes('/api/game/shop')) {
            if (Array.isArray(data.balls)) {
                for (const b of data.balls) {
                    const price = Number(b.priceGold ?? b.price ?? b.cost);
                    if (b && b.id != null && Number.isFinite(price) && price > 0) gameBallPrices[b.id] = price;
                }
            }
            if (Array.isArray(data.items)) {
                for (const it of data.items) {
                    const price = Number(it.priceGold ?? it.price ?? it.cost);
                    if (it && it.id != null && Number.isFinite(price) && price > 0) gamePotionPrices[it.id] = price;
                }
            }
        }

        // 1. Detecta slug da rota (field-init)
        if (data.type === 'field-init') {
            if (data.player && Array.isArray(data.player.team)) {
                for (const p of data.player.team) {
                    if (p && p.id != null) knownPlayerPokeIds.add(String(p.id));
                }
            }
            if (data.slug) {
                const key = normalizeHuntKey(data.slug);
                const prevKey = normalizeHuntKey(currentSlug);
                const isNewSlug = key && prevKey && (key !== prevKey);
                onRouteOrHuntChange(data.slug);
                currentSlug = data.slug;
                currentRoute = data.name ? cleanPokemonName(data.name) : formatHuntName(data.slug);
                if (huntSession) {
                    huntSession.slug = key;
                    if (!huntSession.huntName || /cidade|centro/i.test(huntSession.huntName)) {
                        huntSession.huntName = currentRoute;
                    }
                }
                if (isNewSlug) {
                    resetObservedMoves();
                }
                if (isCity()) {
                    huntingPokemon = '';
                    GM_setValue('piw_huntingPokemon', '');
                    resetObservedMoves();
                    GM_log('[AutoHunt] Entrou em cidade.');
                }
                GM_log('[AutoHunt] Rota detectada:', currentRoute, '(' + currentSlug + ')');
                syncUI();
            }
        }

        // 2. Field Tick (contabiliza tempo ativo na hunt e atualiza nome do monstro)
        if (data.type === 'field' && Number.isFinite(Number(data.seq))) {
            const now = Date.now();

            if (!huntingPokemon && Array.isArray(data.mobs) && data.mobs.length > 0) {
                const firstMob = data.mobs[0];
                if (firstMob && firstMob.speciesId != null) {
                    const cr = creatures.find(c => (c.pokeId || c.id) == firstMob.speciesId);
                    const speciesName = cr ? cleanPokemonName(cr.name) : null;
                    if (speciesName && speciesName !== huntSession.huntName && !/^(kanto|outland|cidade|centro)$/i.test(speciesName)) {
                        huntSession.huntName = speciesName;
                        currentRoute = speciesName;
                    }
                }
            }

            if (huntSession.lastTickAt !== null) {
                const delta = now - huntSession.lastTickAt;
                if (delta > 0 && delta < 5000) {
                    huntSession.activeMs += delta;
                }
            }
            huntSession.lastTickAt = now;
        }

        // Monitora inventário de poções em qualquer pacote (contagem 1x oficial exata)
        trackInventoryPotions(data);

        // 3. Abate Oficial no Campo (XP exata + Drops reais com itens e preços de catálogo)
        if (data.type === 'field-kill') {
            const currentMobName = cleanPokemonName(data.name || data.mob?.name || data.mobName || data.speciesName || huntingPokemon);
            if (currentMobName && !huntingPokemon && !/^(kanto|outland|cidade|centro)$/i.test(currentMobName)) {
                huntSession.huntName = currentMobName;
                currentRoute = currentMobName;
            } else if (currentMobName && (!huntSession.huntName || /cidade|centro|rota/i.test(huntSession.huntName))) {
                huntSession.huntName = currentMobName;
            }

            huntSession.kills += 1;
            const xpGained = Number(data.xpGained ?? data.expGained ?? data.xp ?? data.exp ?? data.gainXp ?? data.heroXp ?? 0);
            if (xpGained > 0) {
                huntSession.xp += xpGained;
            }

            const lootList = data.loot || data.drops || data.items || [];
            if (Array.isArray(lootList)) {
                for (const d of lootList) {
                    if (!d || typeof d !== 'object') continue;
                    const itemId = Number(d.itemId ?? d.id ?? 0);
                    const itInfo = gameItemsMap.get(itemId);
                    const name = String(d.name || itInfo?.name || `Item ${itemId}`);
                    const qty = Number(d.qty ?? d.count ?? d.amount ?? 1) || 1;
                    const price = getItemNpcPrice(itemId, d.price ?? d.priceGold ?? d.npcPrice);
                    const icon = d.icon || itInfo?.icon || '';

                    const key = String(itemId || name);
                    const entry = huntSession.drops.get(key) || { name, itemId, qty: 0, price, icon };
                    entry.qty += qty;
                    if (price > 0) entry.price = price;
                    huntSession.drops.set(key, entry);
                }
            }

            persistHuntSession();
            window.dispatchEvent(new CustomEvent('pw-kill'));
        }

        // 4. Catálogo de Pokébolas e consumo de bolas
        if (data.type === 'balls' && data.counts) {
            if (Array.isArray(data.catalog)) {
                for (const b of data.catalog) {
                    const price = Number(b.priceGold ?? b.price ?? b.cost ?? b.gold ?? b.npcPrice);
                    if (b && b.id != null && Number.isFinite(price) && price > 0) gameBallPrices[b.id] = price;
                    if (b && b.id != null) gameBallCatalog[b.id] = { name: b.name, iconUrl: b.iconUrl };
                }
            }
            if (lastKnownBallsCounts) {
                let ballDiff = 0;
                for (const [id, count] of Object.entries(lastKnownBallsCounts)) {
                    const newCount = Number(data.counts[id] ?? 0);
                    if (newCount < Number(count)) {
                        const diff = Number(count) - newCount;
                        ballDiff += diff;
                        huntSession.ballsByType[id] = (huntSession.ballsByType[id] || 0) + diff;
                    }
                }
                if (ballDiff > 0) {
                    huntSession.balls += ballDiff;
                    persistHuntSession();
                }
            }
            lastKnownBallsCounts = { ...data.counts };
        }

        // 5. Capturas oficiais (apenas novos pokémons capturados, ignorando pokémons já existentes no time)
        if (data.type === 'poke-delta' && data.poke && data.poke.id != null) {
            const p = data.poke;
            const pokeId = String(p.id);
            if (initialPokesLoaded && !knownPlayerPokeIds.has(pokeId)) {
                knownPlayerPokeIds.add(pokeId);
                let val = Number(p.sellValue ?? p.priceNpc ?? 0);
                if (!val || val <= 0) {
                    const c = creatures.find(cr => (cr.pokeId || cr.id) === Number(p.speciesId) || cr.name?.toLowerCase() === p.name?.toLowerCase());
                    val = Number(c?.sellValue ?? c?.priceNpc ?? 0);
                }
                huntSession.capturedPokes.push({
                    id: pokeId,
                    speciesId: p.speciesId,
                    name: p.name,
                    sellValue: val,
                    at: Date.now()
                });
                huntSession.caps = huntSession.capturedPokes.length;
                huntSession.capsValue = huntSession.capturedPokes.reduce((sum, item) => sum + (Number(item.sellValue) || 0), 0);
                persistHuntSession();
                addCaptureLog(p);
                GM_log('[AutoHunt] 🔴 Nova Captura registrada:', p.name, 'Valor: $' + val, 'Total sessão:', huntSession.caps);
            } else {
                knownPlayerPokeIds.add(pokeId);
            }
        }

        // 6. Detecta captura bem-sucedida para troca de rota do AutoHunt
        if (data.type === 'catch-result') {
            if (data.success === true) {
                if (enabled && !busy) {
                    captureCount++;
                    GM_log('[AutoHunt] Captura confirmada pelo servidor! Total alvo:', captureCount);
                    if (data.speciesName) {
                        const nameLower = data.speciesName.toLowerCase();
                        const matchIdx = selectedPokemon.findIndex(n => n.toLowerCase() === nameLower);
                        if (matchIdx !== -1) {
                            const killTgt = GM_getValue('piw_killTarget', 100);
                            const capTgt = GM_getValue('piw_captureTarget', 1);
                            const capKey = 'piw_captures_' + nameLower;
                            const prevCap = GM_getValue(capKey, 0);
                            GM_setValue(capKey, prevCap + 1);
                            const killKey = 'piw_kills_' + nameLower;
                            const totalKills = GM_getValue(killKey, 0);
                            if ((prevCap + 1) >= capTgt && totalKills >= killTgt) {
                                if (!loopMode) {
                                    selectedPokemon.splice(matchIdx, 1);
                                    GM_setValue('piw_selectedPokemon', selectedPokemon);
                                    renderSelectedTags();
                                    GM_log('[AutoHunt] ' + nameLower + ' atingiu os 2 alvos! Removido.');
                                } else {
                                    GM_log('[AutoHunt] ' + nameLower + ' atingiu os 2 alvos! (loop ativo, mantido na lista)');
                                }
                            }
                        }
                    }
                    syncUI();
                    checkSwitch();
                }
            }
        }

        // 7. Detecta golpes tomados
        const hit = extractCombatHit(data);
        if (hit) {
            observedMovesMap.set(hit.name.toLowerCase(), hit);
            if (movesWindowVisible) renderMovesWindow();
        }

        // 8. Detecta atualização de pokémons (líder + stats + shiny + depot)
        if (data.type === 'pokes' || data.type === 'depot' || data.type === 'storage' || data.type === 'box' || data.type === 'poke-update' || data.type === 'party' || data.type === 'level-up') {
            const list = data.list || data.pokes || data.pokemon || data.storage || data.depot || (data.poke ? [data.poke] : null);
            if (list && Array.isArray(list)) {
                detectShinyFromPokes(list);
                updateLeader(list);
            }
        }
    }

    // Escuta mensagens interceptadas do Proxy da página
    window.addEventListener('message', (event) => {
        if (event.source === window && event.data && event.data.__piwHelper) {
            processIncomingWsMessage(event.data.source, event.data.data);
        }
    });

    // ========== WEBSOCKET INTERCEPTION GLOBAL ==========
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
        try {
            socket = this;
        } catch(e) {}
        return origSend.call(this, data);
    };

    const origAddEventListener = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function(type, listener, options) {
        socket = this;
        if (type === 'message' && typeof listener === 'function') {
            const wrappedListener = function(event) {
                try {
                    processIncomingWsMessage('ws', event.data);
                } catch(e) {}
                return listener.call(this, event);
            };
            return origAddEventListener.call(this, type, wrappedListener, options);
        }
        return origAddEventListener.call(this, type, listener, options);
    };

    const origOnMessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
        get: function() { return origOnMessage.get.call(this); },
        set: function(handler) {
            socket = this;
            const wrappedHandler = function(event) {
                try {
                    processIncomingWsMessage('ws', event.data);
                } catch(e) {}
                if (handler) handler.call(this, event);
            };
            origOnMessage.set.call(this, wrappedHandler);
        }
    });

    function syncStatsFromDOM() {
        if (isCity()) return;
    }

    setInterval(() => {
        syncStatsFromDOM();
        const domLeader = getLeaderFromDOM();
        if (domLeader) {
            const hasEvolved = leaderName && domLeader.name.toLowerCase() !== leaderName.toLowerCase();
            const levelUp = leaderLevel > 0 && domLeader.level !== leaderLevel;
            leaderName = domLeader.name;
            leaderLevel = domLeader.level;
            const c = creatures.find(cr => cr.name?.toLowerCase() === leaderName.toLowerCase());
            if (c) {
                leaderPokeId = c.pokeId || c.id || 0;
                leaderTypes = [c.type1, c.type2].filter(Boolean);
                if (currentLeaderData) {
                    currentLeaderData.name = c.name;
                    currentLeaderData.speciesId = c.pokeId || c.id;
                    currentLeaderData.pokeId = c.pokeId || c.id;
                    currentLeaderData.type1 = c.type1;
                    currentLeaderData.type2 = c.type2;
                }
            }
            syncUI();
            if (hasEvolved || levelUp) {
                GM_log('[AutoHunt] Evolução/Level Up detectado via DOM:', leaderName, 'Lv', leaderLevel);
                if (socket && socket.readyState === WebSocket.OPEN) {
                    try { socket.send(JSON.stringify({ type: 'pokes-get' })); } catch(e){}
                }
            }
        }
        if (!isCity() && socket && socket.readyState === WebSocket.OPEN) {
            try { socket.send(JSON.stringify({ type: 'pokes-get' })); } catch(e){}
        }
    }, 1500);

    let sessionShinyCount = 0;
    let isFirstPokesCheck = true;

    // Detecta novos shinies comparando a lista anterior
    function detectShinyFromPokes(pokeList) {
        const currentShinies = pokeList.filter(p => p.shiny);

        if (isFirstPokesCheck) {
            lastPokesList = pokeList.map(p => ({ id: p.id, shiny: p.shiny, name: p.name }));
            isFirstPokesCheck = false;
            return;
        }

        const newShinyIds = currentShinies
            .filter(p => !lastPokesList.some(old => old.id === p.id && old.shiny))
            .map(p => p.id);

        if (newShinyIds.length > 0) {
            for (const shiny of currentShinies.filter(p => newShinyIds.includes(p.id))) {
                sessionShinyCount++;
                GM_log('[AutoHunt] ✨ NOVO SHINY CAPTURADO NESTA SESSÃO!', shiny.name, '(Total sessão:', sessionShinyCount + ')');
            }
            syncUI();
        }

        // Atualiza a lista anterior
        lastPokesList = pokeList.map(p => ({ id: p.id, shiny: p.shiny, name: p.name }));
    }

    function getLeaderFromDOM() {
        const partyMon = document.querySelectorAll(".phud-party .phud-mon");
        for (const mon of partyMon) {
            const isActive = mon.classList.contains("active") || /\(ativo\)/i.test(mon.title || "");
            const nameEl = mon.querySelector(".phud-name");
            const lvEl = mon.querySelector(".phud-lv");
            if (nameEl) {
                const name = cleanPokemonName(nameEl.textContent);
                const lvMatch = (lvEl?.textContent || "").match(/\d+/);
                const level = lvMatch ? Number(lvMatch[0]) : 1;
                if (name && (isActive || partyMon.length === 1)) return { name, level };
            }
        }
        if (partyMon.length > 0) {
            const nameEl = partyMon[0].querySelector(".phud-name");
            const lvEl = partyMon[0].querySelector(".phud-lv");
            if (nameEl) {
                const name = cleanPokemonName(nameEl.textContent);
                const lvMatch = (lvEl?.textContent || "").match(/\d+/);
                const level = lvMatch ? Number(lvMatch[0]) : 1;
                if (name) return { name, level };
            }
        }
        const generalName = document.querySelector(".phud-name, [class*='party-name'], [class*='mon-name']");
        if (generalName) {
            const name = cleanPokemonName(generalName.textContent);
            if (name) return { name, level: 1 };
        }
        return null;
    }

    function getLeaderLevelFromDOM() {
        const partyMon = document.querySelectorAll(".phud-party .phud-mon");
        for (const mon of partyMon) {
            const isActive = mon.classList.contains("active") || /\(ativo\)/i.test(mon.title || "");
            if (!isActive) continue;
            const lvEl = mon.querySelector(".phud-lv");
            if (!lvEl) continue;
            const lvMatch = (lvEl.textContent || "").match(/\d+/);
            const level = lvMatch ? Number(lvMatch[0]) : NaN;
            if (Number.isFinite(level)) {
                return level;
            }
        }
        return null;
    }

    // Atualiza o pokémon líder a partir da lista
    function updateLeader(pokeList) {
        if (Array.isArray(pokeList)) {
            const map = new Map(allPokesList.map(p => [p.id, p]));
            for (const p of pokeList) {
                if (p && p.id != null) map.set(p.id, { ...(map.get(p.id) || {}), ...p });
            }
            allPokesList = Array.from(map.values());
        }
        currentPartyList = allPokesList.filter(p => p.team).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
        const leader = currentPartyList.find(p => p.leader) ?? currentPartyList[0];
        if (leader) {
            currentLeaderData = leader;
            const newName = cleanPokemonName(leader.name);
            const newTypes = [leader.type1, leader.type2].filter(Boolean);
            let newLevel = leader.level || leader.lvl || leader.pokemonLevel || leader.currentLevel || 0;
            const domLevel = getLeaderLevelFromDOM();
            if (domLevel !== null) newLevel = domLevel;
            const newPokeId = leader.pokeId || (() => {
                const c = creatures.find(c => c.name?.toLowerCase() === newName.toLowerCase());
                return c?.pokeId || 0;
            })();
            const debugInfo = `name:${leader.name} lv:${leader.level} keys:${Object.keys(leader).join(',')}`;
            GM_log('[AutoHunt] Leader raw:', debugInfo);
            const changed = newName !== leaderName || JSON.stringify(newTypes) !== JSON.stringify(leaderTypes) || newLevel !== leaderLevel;
            leaderName = newName;
            leaderTypes = newTypes;
            leaderPokeId = newPokeId;
            leaderLevel = newLevel;
            syncUI();
            if (changed) {
                GM_log('[AutoHunt] Líder detectado:', leaderName, '(' + leaderTypes.join('/') + ') Lv', leaderLevel);
            }
        }
    }

    // ========== NAVEGAR ATÉ POKÉMON ==========
    async function navigateToPokemon(pokemonName) {
        try {
            const mapBtn = document.querySelector('button.dock-btn[data-guide="dock-map"]');
            if (!mapBtn) return false;
            mapBtn.click();
            await sleep(800);
            const mapOverlay = document.querySelector('.map-overlay');
            if (!mapOverlay) return false;
            await sleep(400);
            const routeData = routes.find(r => r.name?.toLowerCase() === pokemonName.toLowerCase());
            if (routeData && routeData.area) {
                const areaTabs = document.querySelectorAll('button.map-area');
                for (const tab of areaTabs) {
                    const tabText = tab.textContent?.toLowerCase() || '';
                    const areaName = routeData.area.toLowerCase();
                    if (tabText.includes(areaName) || (tabText.includes('outland') && areaName === 'outland')) {
                        tab.click();
                        await sleep(600);
                        break;
                    }
                }
            }
            let markers = document.querySelectorAll('button.hunt-marker');
            for (const marker of markers) {
                const nameEl = marker.querySelector('.hunt-name');
                if (!nameEl) continue;
                const name = nameEl.textContent.trim();
                if (name.toLowerCase() === pokemonName.toLowerCase()) {
                    resetObservedMoves();
                    marker.click();
                    return true;
                }
            }

            // Se não encontrou na aba atual, varre as outras abas do mapa (ex: Outland / Kanto)
            const areaTabs = document.querySelectorAll('button.map-area');
            for (const tab of areaTabs) {
                if (tab.classList.contains('active')) continue;
                tab.click();
                await sleep(500);
                markers = document.querySelectorAll('button.hunt-marker');
                for (const marker of markers) {
                    const nameEl = marker.querySelector('.hunt-name');
                    if (!nameEl) continue;
                    const name = nameEl.textContent.trim();
                    if (name.toLowerCase() === pokemonName.toLowerCase()) {
                        resetObservedMoves();
                        marker.click();
                        return true;
                    }
                }
            }
        } catch(e) { GM_log('[AutoHunt] navigateToPokemon error:', e); }
        return false;
    }

    // ========== PULAR PARA PRÓXIMO POKÉMON ==========
    async function skipToNextHunt() {
        if (busy) return;
        if (selectedPokemon.length === 0) {
            GM_log('[AutoHunt] Pular: Nenhum pokémon selecionado na lista.');
            return;
        }

        const curName = (huntingPokemon || currentRoute || '').toLowerCase();
        let curIdx = selectedPokemon.findIndex(p => p.toLowerCase() === curName);
        if (curIdx === -1) curIdx = 0;

        let nextPokemon = '';

        if (!loopMode) {
            // Remove o pokémon atual da lista igual ao finalizar o alvo
            const removedName = selectedPokemon.splice(curIdx, 1)[0];
            GM_setValue('piw_selectedPokemon', selectedPokemon);
            renderSelectedTags();
            GM_log('[AutoHunt] ⏭️ ' + removedName + ' pulado e removido da lista.');

            // Se a lista esgotou após a remoção
            if (selectedPokemon.length === 0) {
                GM_log('[AutoHunt] Lista de caça finalizada, voltando pra cidade...');
                huntingPokemon = '';
                GM_setValue('piw_huntingPokemon', '');
                killCount = 0;
                captureCount = 0;
                resetObservedMoves();
                const cityBtn = document.querySelector('button.dock-btn[data-guide="dock-home"], button.dock-btn[data-guide*="home"], button.dock-btn[data-guide*="city"], [class*="dock"] [class*="home"], [class*="dock"] [class*="city"]');
                if (cityBtn) cityBtn.click();
                enabled = false;
                GM_setValue('piw_enabled', false);
                syncUI();
                return;
            }

            // O próximo é o que ocupou a posição curIdx (ou o primeiro)
            nextPokemon = selectedPokemon[curIdx % selectedPokemon.length];
        } else {
            // Em Modo Loop: não remove da lista, apenas avança para o próximo
            if (selectedPokemon.length > 1) {
                const nextIdx = (curIdx + 1) % selectedPokemon.length;
                nextPokemon = selectedPokemon[nextIdx];
            } else {
                nextPokemon = selectedPokemon[0];
            }
            GM_log('[AutoHunt] ⏭️ Pulando caça (Modo Loop) para:', nextPokemon);
        }

        busy = true;
        syncUI();

        try {
            killCount = 0;
            captureCount = 0;
            huntingPokemon = nextPokemon;
            const slug = nextPokemon.toLowerCase().replace(/\s+/g, '-');
            GM_setValue('piw_kills_' + slug, 0);
            GM_setValue('piw_captures_' + slug, 0);
            resetObservedMoves();

            if (!enabled) {
                enabled = true;
                GM_setValue('piw_enabled', true);
            }

            const ok = await navigateToPokemon(nextPokemon);
            if (ok) {
                currentRoute = nextPokemon;
            }
        } catch(e) {
            GM_log('[AutoHunt] Erro ao pular hunt:', e);
        } finally {
            busy = false;
            syncUI();
        }
    }

    // ========== TROCAR DE ROTA ==========
    async function doSwitch() {
        busy = true;
        syncUI();
        GM_log('[AutoHunt] Alvo atingido! Procurando nova rota...');

        try {
            // 1) Abre o mapa
            const mapBtn = document.querySelector('button.dock-btn[data-guide="dock-map"]');
            if (!mapBtn) {
                GM_log('[AutoHunt] Botão do mapa não encontrado');
                busy = false;
                return;
            }
            mapBtn.click();
            await sleep(800);

            // 2) Espera o modal do mapa aparecer
            const mapOverlay = document.querySelector('.map-overlay');
            if (!mapOverlay) {
                GM_log('[AutoHunt] Mapa não abriu');
                busy = false;
                return;
            }
            await sleep(400);

            let found = false;

            // Se tem pokémons selecionados, procura rotas com esses pokémons
            if (selectedPokemon.length > 0) {
                // Procura pokémons selecionados que estão no mapa
                for (const pokemon of selectedPokemon) {
                    if (found) break;

                    // Busca a rota nos dados do mapa se existir
                    const routeData = routes.find(r => r.name?.toLowerCase() === pokemon.toLowerCase());

                    // Se tem área conhecida, clica na aba do mapa correspondente
                    if (routeData && routeData.area) {
                        const areaTabs = document.querySelectorAll('button.map-area');
                        for (const tab of areaTabs) {
                            const tabText = tab.textContent?.toLowerCase() || '';
                            const areaName = routeData.area.toLowerCase();
                            if (tabText.includes(areaName) || (tabText.includes('outland') && areaName === 'outland')) {
                                GM_log('[AutoHunt] Clicando aba:', tab.textContent.trim());
                                tab.click();
                                await sleep(600);
                                break;
                            }
                        }
                    }

                    // Tenta encontrar o marcador no mapa visível
                    let targetMarker = null;
                    let markers = document.querySelectorAll('button.hunt-marker');
                    for (const marker of markers) {
                        const nameEl = marker.querySelector('.hunt-name');
                        if (!nameEl) continue;
                        const name = nameEl.textContent.trim();
                        if (name.toLowerCase() === pokemon.toLowerCase() && !marker.classList.contains('here')) {
                            targetMarker = marker;
                            break;
                        }
                    }

                    // Se não achou na aba atual, varre as abas do mapa (ex: Outland / Kanto)
                    if (!targetMarker) {
                        const areaTabs = document.querySelectorAll('button.map-area');
                        for (const tab of areaTabs) {
                            if (tab.classList.contains('active')) continue;
                            tab.click();
                            await sleep(500);
                            markers = document.querySelectorAll('button.hunt-marker');
                            for (const marker of markers) {
                                const nameEl = marker.querySelector('.hunt-name');
                                if (!nameEl) continue;
                                const name = nameEl.textContent.trim();
                                if (name.toLowerCase() === pokemon.toLowerCase() && !marker.classList.contains('here')) {
                                    targetMarker = marker;
                                    break;
                                }
                            }
                            if (targetMarker) break;
                        }
                    }

                    if (targetMarker) {
                        // Se mudou de pokémon, zera contadores
                        if (huntingPokemon !== pokemon) {
                            killCount = 0;
                            captureCount = 0;
                            huntingPokemon = pokemon;
                            const slug = pokemon.toLowerCase().replace(/\s+/g, '-');
                            GM_setValue('piw_kills_' + slug, 0);
                            GM_setValue('piw_captures_' + slug, 0);
                            GM_log('[AutoHunt] Novo pokémon:', pokemon, '- contadores resetados.');
                        }
                        resetObservedMoves();
                        GM_log('[AutoHunt] Clicando rota:', pokemon);
                        targetMarker.click();
                        currentRoute = pokemon;
                        found = true;
                        break;
                    }
                }
            } else {
                GM_log('[AutoHunt] Lista vazia, voltando pra cidade...');
                const cityBtn = document.querySelector('button.dock-btn[data-guide="dock-home"], [class*="home"], [class*="city"]');
                if (cityBtn) cityBtn.click();
                enabled = false;
                GM_setValue('piw_enabled', false);
                syncUI();
                return;
            }

            // Se não encontrou nenhum pokémon selecionado, pega qualquer rota diferente da atual
            if (!found) {
                const markers = document.querySelectorAll('button.hunt-marker');
                for (const marker of markers) {
                    const nameEl = marker.querySelector('.hunt-name');
                    if (!nameEl) continue;
                    const name = nameEl.textContent.trim();
                    if (name && !marker.classList.contains('here')) {
                        GM_log('[AutoHunt] Fallback rota:', name);
                        marker.click();
                        currentRoute = name;
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                GM_log('[AutoHunt] Nenhuma rota encontrada, pausando...');
                enabled = false;
                GM_setValue('piw_enabled', false);
                syncUI();
            }

        } catch(e) {
            GM_log('[AutoHunt] Erro no switch:', e);
        }

        busy = false;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ========== INICIALIZAR ==========
    async function init() {
        const check = setInterval(() => {
            if (document.body && (document.querySelector('.game-root, .game-canvas-host, [class*="game-"]') || document.readyState === 'complete' || document.readyState === 'interactive')) {
                clearInterval(check);
                buildPanel();
                createInfoWindowDOM();
                createMovesWindowDOM();
                createTrackerWindowDOM();
                createCapturesWindowDOM();
                applyOpacityAll();
                if (trackerWindowVisible) {
                    renderTrackerWindow();
                    if (!trackerInterval) {
                        trackerInterval = setInterval(() => {
                            if (trackerWindowVisible && trackerActiveTab === 'session') {
                                renderTrackerWindow();
                            }
                        }, 1000);
                    }
                }
                if (capturesWindowVisible) {
                    renderCapturesWindow();
                }
                syncUI();
                setTimeout(async () => {
                    await fetchGameData();
                    syncUI();
                }, 500);
                setTimeout(() => {
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'pokes-get' }));
                    }
                }, 3000);
                GM_log('[Poke Helper] Painel criado');
            }
        }, 200);
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();

    GM_log('[Poke Helper] Carregado v2.1.0.');
})();
