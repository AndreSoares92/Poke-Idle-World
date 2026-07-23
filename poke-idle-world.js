// ==UserScript==
// @name         Poke Idle World - Auto Hunt Switcher
// @namespace    http://tampermonkey.net/
// @version      0.19.0
// @description  Escolha os pokémons que quer caçar e ele troca automaticamente de rota.
// @author       You
// @match        https://poke.idleworld.online/play
// @icon         https://poke.idleworld.online/favicon.ico
// @updateURL    https://raw.githubusercontent.com/AndreSoares92/Poke-Idle-World/main/poke-idle-world-auto-hunt.js
// @downloadURL  https://raw.githubusercontent.com/AndreSoares92/Poke-Idle-World/main/poke-idle-world-auto-hunt.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    // ========== CONFIG (persistida) ==========
    const KILL_TARGET    = GM_getValue('piw_killTarget', 100);
    const CAPTURE_TARGET = GM_getValue('piw_captureTarget', 1);
    let enabled          = GM_getValue('piw_enabled', true);
    let selectedPokemon  = GM_getValue('piw_selectedPokemon', []); // Array de nomes
    let huntRoutes       = []; // {slug, name, level} de todas as rotas

    // Cidades (não troca automaticamente)
    const CITY_SLUGS = new Set(['cerulean', 'pewter', 'viridian', 'cassino', 'lavender']);

    // ========== SISTEMA DE TIPOS ==========
    // Quais tipos são fracos contra cada tipo (quem é efetivo contra quem)
    const TYPE_WEAKNESS = {
        NORMAL:   ['FIGHTING'],
        FIRE:     ['WATER', 'GROUND', 'ROCK'],
        WATER:    ['GRASS', 'ELECTRIC'],
        GRASS:    ['FIRE', 'ICE', 'POISON', 'FLYING', 'BUG'],
        ELECTRIC: ['GROUND'],
        ICE:      ['FIRE', 'FIGHTING', 'ROCK', 'STEEL'],
        BUG:      ['FIRE', 'FLYING', 'ROCK'],
        POISON:   ['GROUND', 'PSYCHIC'],
        GROUND:   ['WATER', 'GRASS', 'ICE'],
        ROCK:     ['WATER', 'GRASS', 'FIGHTING', 'GROUND', 'STEEL'],
        FLYING:   ['ELECTRIC', 'ICE', 'ROCK'],
        PSYCHIC:  ['BUG', 'GHOST', 'DARK'],
        GHOST:    ['GHOST', 'DARK'],
        DRAGON:   ['ICE', 'DRAGON', 'FAIRY'],
        DARK:     ['FIGHTING', 'BUG', 'FAIRY'],
        STEEL:    ['FIRE', 'FIGHTING', 'GROUND'],
        FAIRY:    ['POISON', 'STEEL'],
        FIGHTING: ['FLYING', 'PSYCHIC', 'FAIRY'],
    };

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

    // Tabela fixa dos pokémons que têm versão shiny no jogo (64 espécies)
    const SHINY_SPECIES_IDS = new Set([
        3, 6, 9, 12, 15, 18, 19, 20, 22, 26, 34, 41, 43, 45,
        46, 47, 48, 49, 58, 59, 63, 65, 68, 72, 73, 76, 82, 83,
        88, 89, 94, 95, 97, 98, 99, 100, 101, 104, 105, 106, 107, 114,
        116, 117, 122, 123, 124, 125, 126, 127, 128, 129, 130, 132, 134, 135,
        136, 143, 147, 148, 157, 178, 181, 247
    ]);

    // Estado do líder
    let leaderName = '';
    let leaderTypes = [];
    let filterWeakOnly = GM_getValue('piw_filterWeakOnly', false);
    let currentPage = 1;
    const ITEMS_PER_PAGE = 25;
    let shinyOnlyMode = GM_getValue('piw_shinyOnly', false);
    let shinyCount = 0;
    let lastPokesList = []; // Lista anterior de pokémons pra detectar novos shinies
    let ownedShinies = new Set(); // Removido - não precisa mais
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
    position: fixed; bottom: 76px; right: 10px; z-index: 10;
    background: rgba(13,17,23,.96); border: 1px solid #8a7a50; border-radius: 10px;
    padding: 14px; color: #e0e0e0; font: 13px/1.4 'Segoe UI',sans-serif;
    min-width: 340px; max-width: 340px; box-shadow: 0 4px 24px rgba(0,0,0,.7);
    backdrop-filter: blur(6px); user-select: none;
    max-height: 85vh; overflow-y: auto; overflow-x: hidden;
}
.piw-panel h3 { margin: 0 0 6px; font-size: 14px; color: #c8b878; font-weight: 600; letter-spacing: .5px; cursor: grab; user-select: none; }
.piw-panel h3:active { cursor: grabbing; }
.piw-panel .piw-stat { font-size: 13px; font-weight: 600; text-align: center; margin: 2px 0; font-variant-numeric: tabular-nums; }
.piw-panel .piw-stat.piw-kills { color: #f0c040; }
.piw-panel .piw-stat.piw-captures { color: #4ade80; }
.piw-panel .piw-progress { height: 4px; background: #1a2030; border-radius: 3px; overflow: hidden; margin: 4px 0; }
.piw-panel .piw-progress-bar { height: 100%; background: linear-gradient(90deg,#b8860b,#f0c040); transition: width .3s; border-radius: 3px; }
.piw-panel .piw-route { font-size: 11px; color: #8899aa; text-align: center; }
.piw-panel .piw-label { display: flex; align-items: center; gap: 6px; margin: 5px 0; font-size: 12px; }
.piw-panel .piw-label input[type=number] {
    background: #1a2030; border: 1px solid #8a7a50; border-radius: 4px;
    color: #e0e0e0; padding: 2px 4px; font-size: 12px; width: 52px;
}
.piw-panel .piw-label input[type=checkbox] { width: auto; accent-color: #f0c040; }
.piw-panel .piw-row { display: flex; justify-content: space-between; align-items: center; gap: 4px; }
.piw-panel .piw-btn {
    background: #1a2030; border: 1px solid #8a7a50; color: #e0e0e0; border-radius: 4px;
    padding: 3px 10px; cursor: pointer; font-size: 11px; transition: background .15s;
}
.piw-panel .piw-btn:hover { background: #2a3040; }
.piw-panel .piw-btn:active { background: #3a4050; }
.piw-panel .piw-btn.piw-btn-primary { background: #b8860b; }
.piw-panel .piw-btn.piw-btn-primary:hover { background: #d4a017; }
.piw-panel hr { border: none; border-top: 1px solid #2a3040; margin: 8px 0; }
.piw-panel .piw-status { font-size: 11px; text-align: center; padding: 3px 0; }
.piw-panel .piw-status.on  { color: #4ade80; }
.piw-panel .piw-status.off { color: #f87171; }
.piw-panel .piw-search {
    background: #1a2030; border: 1px solid #8a7a50; border-radius: 4px;
    color: #e0e0e0; padding: 4px 8px; font-size: 12px; width: 100%;
    box-sizing: border-box; margin-bottom: 4px;
}
.piw-panel .piw-search::placeholder { color: #8899aa; }
.piw-panel .piw-pokemon-list {
    max-height: 120px; overflow-y: auto; border: 1px solid #2a3040;
    border-radius: 4px; margin-bottom: 6px; background: #0d1117;
}
.piw-panel .piw-pokemon-item {
    padding: 3px 8px; cursor: pointer; font-size: 12px;
    display: flex; align-items: center; gap: 6px;
}
.piw-panel .piw-pokemon-item:hover { background: #1a2030; }
.piw-panel .piw-pokemon-item.selected { background: #1a2a1a; color: #4ade80; }
.piw-panel .piw-pokemon-item .piw-check { width: 14px; text-align: center; }
.piw-panel .piw-selected-tags {
    display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0;
    min-height: 20px;
}
.piw-panel .piw-tag {
    background: #1a2a1a; border: 1px solid #4ade80; border-radius: 3px;
    padding: 1px 6px; font-size: 10px; color: #4ade80;
    display: flex; align-items: center; gap: 3px;
}
.piw-panel .piw-tag-remove {
    cursor: pointer; color: #f87171; font-weight: bold;
}
.piw-panel .piw-tag-remove:hover { color: #ff4444; }
.piw-panel .piw-hint { font-size: 10px; color: #8899aa; text-align: center; margin-top: 2px; }
.piw-panel .piw-btns-row { display: flex; gap: 4px; margin-bottom: 4px; }
.piw-panel .piw-btns-row .piw-btn { flex: 1; font-size: 10px; padding: 2px 6px; }
.piw-panel .piw-city { font-size: 11px; color: #f0c040; text-align: center; padding: 2px 0; }
.piw-panel .piw-dual-progress { display: flex; gap: 4px; margin: 4px 0; }
.piw-panel .piw-dual-progress-item { flex: 1; }
.piw-panel .piw-dual-progress-label { font-size: 10px; color: #8899aa; text-align: center; margin-bottom: 1px; }
.piw-panel .piw-dual-progress .piw-progress { height: 6px; }
.piw-panel .piw-dual-progress .piw-bar-kills { background: linear-gradient(90deg,#b8860b,#f0c040); }
.piw-panel .piw-dual-progress .piw-bar-caps { background: linear-gradient(90deg,#166534,#4ade80); }
.piw-panel .piw-leader { font-size: 11px; color: #c084fc; text-align: center; padding: 2px 0; }
.piw-panel .piw-filter-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 11px; }
.piw-panel .piw-filter-row input[type=checkbox] { width: auto; accent-color: #c084fc; }
.piw-panel .piw-pagination { display: flex; justify-content: center; align-items: center; gap: 6px; margin: 4px 0; font-size: 11px; }
.piw-panel .piw-pagination .piw-btn { padding: 2px 8px; font-size: 10px; }
.piw-panel .piw-pagination .piw-page-info { color: #8899aa; }
.piw-panel .piw-shiny { font-size: 11px; color: #f0c040; text-align: center; padding: 2px 0; }
.piw-panel .piw-pokemon-item .piw-shiny-icon { color: #f0c040; margin-left: 4px; }
.piw-panel .piw-close { cursor: pointer; color: #8899aa; font-size: 16px; line-height: 1; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
.piw-panel .piw-close:hover { color: #f87171; }
#piw-reopen {
    position: fixed; top: 5px; right: 10px; z-index: 10;
    width: 32px; height: 32px; border-radius: 6px;
    background: rgba(13,17,23,.95); border: 1px solid #8a7a50;
    color: #c8b878; font-size: 14px; cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,.5); display: none;
    align-items: center; justify-content: center;
}
#piw-reopen:hover { background: #1a2030; }
`);

    // ========== UI ==========
    let panel;

    // Detecta se está em cidade
    function isCity() {
        if (!currentSlug) return false;
        return CITY_SLUGS.has(currentSlug);
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.className = 'piw-panel';
        panel.innerHTML = `
            <h3 style="display:flex;justify-content:space-between;align-items:center">Auto Hunt <span style="display:flex;align-items:center;gap:6px"><span id="piw-minimize" class="piw-close" title="Minimizar">−</span> <span id="piw-close-panel" class="piw-close" title="Fechar painel">✕</span></span></h3>
            <div style="display:flex;gap:6px;justify-content:center;margin:4px 0 6px">
                <button class="piw-btn" id="piw-play" style="background:#22c55e;color:#fff;padding:4px 10px;border:none;border-radius:4px;cursor:pointer;font-weight:bold" title="Iniciar caça">▶ Play</button>
                <button class="piw-btn" id="piw-stop" style="background:#ef4444;color:#fff;padding:4px 10px;border:none;border-radius:4px;cursor:pointer;font-weight:bold" title="Parar e voltar pra cidade">■ Stop</button>
            </div>
            <div id="piw-minimized-view" style="display:none;text-align:center">
                <div id="piw-start-hunt-mini" style="display:none;margin:4px 0">
                    <button class="piw-btn" id="piw-start-btn-mini" style="background:#b8860b;color:#fff;padding:6px 16px;border:none;border-radius:6px;cursor:pointer;font-weight:bold">Começar caça</button>
                </div>
                <div class="piw-leader" id="piw-leader-mini" style="font-size:11px">Líder: —</div>
                <div class="piw-shiny" id="piw-shiny-mini" style="font-size:11px">✨ Shiny: 0</div>
                <div class="piw-stat" id="piw-kills-mini" style="font-size:12px;color:#ffd700">Abates: 0 / 100</div>
                <div class="piw-stat" id="piw-caps-mini" style="font-size:12px;color:#4ade80">Capturas: 0 / 1</div>
                <div class="piw-dual-progress">
                    <div class="piw-dual-progress-item">
                        <div class="piw-dual-progress-label">Abates</div>
                        <div class="piw-progress"><div class="piw-progress-bar piw-bar-kills" id="piw-bar-kills-mini" style="width:0%"></div></div>
                    </div>
                    <div class="piw-dual-progress-item">
                        <div class="piw-dual-progress-label">Capturas</div>
                        <div class="piw-progress"><div class="piw-progress-bar piw-bar-caps" id="piw-bar-caps-mini" style="width:0%"></div></div>
                    </div>
                </div>
                <div id="piw-route-mini" style="font-size:11px;color:#8899aa">—</div>
                <div class="piw-status" id="piw-status-mini" style="font-size:11px">○ Pausado</div>
            </div>
            <div id="piw-full-content">
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
            <div class="piw-route" id="piw-route">—</div>
            <hr>
            <label class="piw-label">
                <input type="checkbox" id="piw-shiny-only" ${shinyOnlyMode?'checked':''}>
                Só trocar após capturar shiny
            </label>
            <label class="piw-label">
                <input type="checkbox" id="piw-loop" ${loopMode?'checked':''}>
                Modo loop (não remover da lista)
            </label>
            <label class="piw-label">
                <input type="checkbox" id="piw-exit-kills" ${exitOnKills?'checked':''}>
                Sair ao atingir abates
            </label>
            <label class="piw-label">
                <input type="checkbox" id="piw-exit-captures" ${exitOnCaptures?'checked':''}>
                Sair ao atingir capturas
            </label>
            <div class="piw-row">
                <label class="piw-label" style="flex:1">
                    Alvo abates <input type="number" id="piw-target" value="${KILL_TARGET}" min="1" max="999">
                </label>
            </div>
            <div class="piw-row">
                <label class="piw-label" style="flex:1">
                    Alvo capturas <input type="number" id="piw-capture-target" value="${CAPTURE_TARGET}" min="1" max="99">
                </label>
            </div>
            <hr>
            <div style="font-size:12px;color:#8899aa;margin-bottom:4px;cursor:pointer;display:flex;align-items:center;gap:4px" id="piw-tags-toggle">Pokemon para caçar: <span style="font-size:10px">▼</span></div>
            <div class="piw-selected-tags" id="piw-selected-tags" style="display:none"></div>
            <div class="piw-filter-row">
                <input type="checkbox" id="piw-filter-weak" ${filterWeakOnly?'checked':''}>
                <label for="piw-filter-weak">Só mostrar fracos contra o líder</label>
            </div>
            <div class="piw-filter-row">
                <input type="checkbox" id="piw-filter-shiny" ${filterShinyAvail?'checked':''}>
                <label for="piw-filter-shiny">Só mostrar com versão shiny</label>
            </div>
            <input type="text" class="piw-search" id="piw-search" placeholder="Buscar pokemon...">
            <div class="piw-pokemon-list" id="piw-pokemon-list"></div>
            <div class="piw-pagination" id="piw-pagination">
                <button class="piw-btn" id="piw-prev-page">&lt;</button>
                <span class="piw-page-info" id="piw-page-info">1 / 1</span>
                <button class="piw-btn" id="piw-next-page">&gt;</button>
            </div>
            <div class="piw-btns-row">
                <button class="piw-btn" id="piw-select-all">Selecionar todos</button>
                <button class="piw-btn" id="piw-clear-all">Limpar tudo</button>
            </div>
            <div class="piw-hint" id="piw-hint">Nenhum selecionado - troca qualquer rota</div>
            <hr>
            <div style="text-align:center;margin-top:4px">
                <button class="piw-btn" id="piw-reset">Resetar contadores</button>
            </div>
            <div class="piw-status ${enabled?'on':'off'}" id="piw-status">${enabled?'● Rodando':'○ Pausado'}</div>
            </div>
            </div>
        `;

        // Event listeners
        // Minimizar/maximizar
        let minimized = GM_getValue('piw_minimized', false);
        const miniView = panel.querySelector('#piw-minimized-view');
        const fullContent = panel.querySelector('#piw-full-content');
        const minBtn = panel.querySelector('#piw-minimize');
        if (minimized) {
            miniView.style.display = '';
            fullContent.style.display = 'none';
            minBtn.textContent = '+';
        }
        minBtn.addEventListener('click', () => {
            minimized = !minimized;
            GM_setValue('piw_minimized', minimized);
            miniView.style.display = minimized ? '' : 'none';
            fullContent.style.display = minimized ? 'none' : '';
            minBtn.textContent = minimized ? '+' : '−';
            syncUI();
        });

        // Fechar/reabrir painel
        const closeBtn = panel.querySelector('#piw-close-panel');
        const reopenBtn = document.createElement('button');
        reopenBtn.id = 'piw-reopen';
        reopenBtn.innerHTML = '🐾';
        reopenBtn.title = 'Abrir Auto Hunt';
        document.body.appendChild(reopenBtn);
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
            reopenBtn.style.display = 'flex';
        });
        reopenBtn.addEventListener('click', () => {
            panel.style.display = '';
            reopenBtn.style.display = 'none';
        });

        // Botão Começar caça (visão minimizada)
        const startBtnMini = panel.querySelector('#piw-start-btn-mini');
        if (startBtnMini) {
            startBtnMini.onclick = () => {
                if (!busy && selectedPokemon.length > 0) {
                    enabled = true;
                    GM_setValue('piw_enabled', true);
                    doSwitch();
                }
            };
        }

        // Botão Play - iniciar caça
        panel.querySelector('#piw-play').addEventListener('click', () => {
            if (!busy && selectedPokemon.length > 0) {
                enabled = true;
                GM_setValue('piw_enabled', true);
                doSwitch();
            }
        });
        // Botão Stop - parar e voltar pra cidade
        panel.querySelector('#piw-stop').addEventListener('click', () => {
            enabled = false;
            GM_setValue('piw_enabled', false);
            syncUI();
            // Tenta clicar no ícone da casa pra voltar pra cidade
            const houseBtn = document.querySelector('button.dock-btn[data-guide="dock-home"], [class*="home"], [class*="city"]');
            if (houseBtn) {
                houseBtn.click();
                GM_log('[AutoHunt] Stop: voltando pra cidade');
            }
        });
        panel.querySelector('#piw-shiny-only').onchange = function() {
            shinyOnlyMode = this.checked;
            GM_setValue('piw_shinyOnly', shinyOnlyMode);
            syncUI();
        };
        panel.querySelector('#piw-loop').onchange = function() {
            loopMode = this.checked;
            GM_setValue('piw_loopMode', loopMode);
            syncUI();
        };
        panel.querySelector('#piw-exit-kills').onchange = function() {
            exitOnKills = this.checked;
            GM_setValue('piw_exitOnKills', exitOnKills);
            syncUI();
        };
        panel.querySelector('#piw-exit-captures').onchange = function() {
            exitOnCaptures = this.checked;
            GM_setValue('piw_exitOnCaptures', exitOnCaptures);
            syncUI();
        };
        panel.querySelector('#piw-target').onchange = function() {
            GM_setValue('piw_killTarget', parseInt(this.value) || 100);
            syncUI();
        };
        panel.querySelector('#piw-capture-target').onchange = function() {
            GM_setValue('piw_captureTarget', parseInt(this.value) || 1);
            syncUI();
        };
        panel.querySelector('#piw-reset').onclick = () => { killCount = 0; captureCount = 0; syncUI(); };

        // Botão Começar caça (full view) - removido, agora é Play/Stop

        // Toggle lista de selecionados
        panel.querySelector('#piw-tags-toggle').addEventListener('click', () => {
            const tags = document.getElementById('piw-selected-tags');
            const arrow = panel.querySelector('#piw-tags-toggle span');
            if (tags.style.display === 'none') {
                tags.style.display = '';
                arrow.textContent = '▲';
            } else {
                tags.style.display = 'none';
                arrow.textContent = '▼';
            }
        });

        // Botão Limpar tudo
        panel.querySelector('#piw-clear-all').addEventListener('click', () => {
            selectedPokemon = [];
            GM_setValue('piw_selectedPokemon', selectedPokemon);
            renderSelectedTags();
            renderPokemonList(document.getElementById('piw-search')?.value || '');
        });

        // Botão Selecionar todos
        panel.querySelector('#piw-select-all').addEventListener('click', () => {
            const filtered = getFilteredPokemonList();
            selectedPokemon = filtered.map(p => p.name);
            GM_setValue('piw_selectedPokemon', selectedPokemon);
            renderSelectedTags();
            renderPokemonList(document.getElementById('piw-search')?.value || '');
        });

        // Busca de pokémon
        const searchInput = panel.querySelector('#piw-search');
        searchInput.addEventListener('input', () => {
            currentPage = 1;
            renderPokemonList(searchInput.value);
        });

        // Filtro de fraqueza
        panel.querySelector('#piw-filter-weak').addEventListener('change', function() {
            filterWeakOnly = this.checked;
            GM_setValue('piw_filterWeakOnly', filterWeakOnly);
            currentPage = 1;
            renderPokemonList(document.getElementById('piw-search')?.value || '');
        });

        // Filtro de shiny disponível
        panel.querySelector('#piw-filter-shiny').addEventListener('change', function() {
            filterShinyAvail = this.checked;
            GM_setValue('piw_filterShinyAvail', filterShinyAvail);
            currentPage = 1;
            renderPokemonList(document.getElementById('piw-search')?.value || '');
        });

        // Paginação
        panel.querySelector('#piw-prev-page').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderPokemonList(document.getElementById('piw-search')?.value || '');
            }
        });
        panel.querySelector('#piw-next-page').addEventListener('click', () => {
            currentPage++;
            renderPokemonList(document.getElementById('piw-search')?.value || '');
        });

        document.body.appendChild(panel);

        // Torna o painel arrastável pelo título
        const title = panel.querySelector('h3');
        let isDragging = false, offsetX, offsetY;

        // Restaura posição salva
        const savedPos = GM_getValue('piw_panelPos', null);
        if (savedPos) {
            panel.style.left = savedPos.left;
            panel.style.top = savedPos.top;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }

        title.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - panel.getBoundingClientRect().left;
            offsetY = e.clientY - panel.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - offsetX) + 'px';
            panel.style.top = (e.clientY - offsetY) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                GM_setValue('piw_panelPos', {
                    left: panel.style.left,
                    top: panel.style.top
                });
            }
        });

        renderSelectedTags();
        renderPokemonList('');
    }

    function syncUI() {
        const target = GM_getValue('piw_killTarget', 100);
        const capTarget = GM_getValue('piw_captureTarget', 1);
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
            st.textContent = enabled ? '● Rodando' : '○ Pausado';
            st.className = 'piw-status ' + (enabled ? 'on' : 'off');
        }
        if (cityEl) {
            const inCity = isCity();
            cityEl.style.display = inCity ? 'block' : 'none';
        }
        if (leaderEl) {
            if (leaderName) {
                const types = leaderTypes.join(' / ');
                leaderEl.textContent = `Líder: ${leaderName} (${types})`;
            } else {
                leaderEl.textContent = 'Líder: —';
            }
        }
        if (shinyEl) {
            shinyEl.textContent = `✨ Shiny: ${shinyCount}`;
        }
        // Atualiza visão minimizada
        const statusMini = document.getElementById('piw-status-mini');
        if (statusMini) {
            statusMini.textContent = enabled ? '● Rodando' : '○ Pausado';
            statusMini.className = 'piw-status ' + (enabled ? 'on' : 'off');
        }
        const leaderMini = document.getElementById('piw-leader-mini');
        if (leaderMini) {
            if (leaderName) {
                leaderMini.textContent = `Líder: ${leaderName} (${leaderTypes.join(' / ')})`;
            } else {
                leaderMini.textContent = 'Líder: —';
            }
        }
        const shinyMini = document.getElementById('piw-shiny-mini');
        if (shinyMini) shinyMini.textContent = `✨ Shiny: ${shinyCount}`;
        const killsMini = document.getElementById('piw-kills-mini');
        const capsMini = document.getElementById('piw-caps-mini');
        const barKillsMini = document.getElementById('piw-bar-kills-mini');
        const barCapsMini = document.getElementById('piw-bar-caps-mini');
        if (killsMini) killsMini.textContent = `Abates: ${killCount} / ${target}`;
        if (capsMini) capsMini.textContent = `Capturas: ${captureCount} / ${capTarget}`;
        if (barKillsMini) barKillsMini.style.width = Math.min(100, killCount/target*100) + '%';
        if (barCapsMini) barCapsMini.style.width = Math.min(100, captureCount/capTarget*100) + '%';
        const routeMini = document.getElementById('piw-route-mini');
        if (routeMini) routeMini.textContent = currentRoute || '—';
        const startMini = document.getElementById('piw-start-hunt-mini');
        if (startMini) startMini.style.display = (isCity() && selectedPokemon.length > 0 && !busy) ? 'block' : 'none';
        saveState();
    }

    // ========== POKEMON SELECTOR ==========
    function renderSelectedTags() {
        const container = document.getElementById('piw-selected-tags');
        const hint = document.getElementById('piw-hint');
        if (!container) return;
        container.innerHTML = selectedPokemon.map((name, idx) =>
            `<span class="piw-tag" draggable="true" data-idx="${idx}" style="cursor:grab">${name} <span class="piw-tag-remove" data-name="${name}">&times;</span></span>`
        ).join('');
        if (hint) {
            hint.textContent = selectedPokemon.length === 0
                ? 'Nenhum selecionado - troca qualquer rota'
                : `${selectedPokemon.length} pokemon(s) selecionado(s)`;
        }
        // Event listeners para remover
        container.querySelectorAll('.piw-tag-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedPokemon = selectedPokemon.filter(n => n !== btn.dataset.name);
                GM_setValue('piw_selectedPokemon', selectedPokemon);
                renderSelectedTags();
                renderPokemonList(document.getElementById('piw-search')?.value || '');
            });
        });
        // Drag and drop pra reordenar
        let dragIdx = null;
        container.querySelectorAll('.piw-tag').forEach(tag => {
            tag.addEventListener('dragstart', (e) => {
                dragIdx = parseInt(tag.dataset.idx);
                tag.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            });
            tag.addEventListener('dragend', () => {
                tag.style.opacity = '1';
                dragIdx = null;
                container.querySelectorAll('.piw-tag').forEach(t => t.style.borderTop = '');
            });
            tag.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                tag.style.borderTop = '2px solid #b8860b';
            });
            tag.addEventListener('dragleave', () => {
                tag.style.borderTop = '';
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

    function getFilteredPokemonList(filter) {
        const pokemonMap = new Map();
        routes.forEach(r => {
            if (r.name) pokemonMap.set(r.name.toLowerCase(), { name: r.name, level: r.level || 0 });
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
            pokemonArray = pokemonArray.filter(p => p.name.toLowerCase().includes(f));
        }
        pokemonArray.sort((a, b) => a.level - b.level);
        return pokemonArray;
    }

    function renderPokemonList(filter) {
        const list = document.getElementById('piw-pokemon-list');
        const pageInfo = document.getElementById('piw-page-info');
        const prevBtn = document.getElementById('piw-prev-page');
        const nextBtn = document.getElementById('piw-next-page');
        if (!list) return;

        let pokemonArray = getFilteredPokemonList(filter);

        // Ordena por nível
        pokemonArray.sort((a, b) => a.level - b.level);

        // Paginação
        const totalPages = Math.max(1, Math.ceil(pokemonArray.length / ITEMS_PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
        const pageItems = pokemonArray.slice(startIdx, startIdx + ITEMS_PER_PAGE);

        // Atualiza controles de paginação
        if (pageInfo) pageInfo.textContent = `${currentPage} / ${totalPages}`;
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

        list.innerHTML = pageItems.map(pokemon => {
            const sel = selectedPokemon.includes(pokemon.name);
            const lvlText = pokemon.level > 0 ? ` <span style="color:#8899aa">Lv.${pokemon.level}</span>` : '';
            const canBeShiny = shinyAvailable.has(pokemon.name.toLowerCase());
            const shinyIcon = canBeShiny ? ` <span class="piw-shiny-icon">✨</span>` : '';
            return `<div class="piw-pokemon-item${sel?' selected':''}" data-name="${pokemon.name}">
                <span class="piw-check">${sel ? '✓' : ''}</span>
                ${pokemon.name}${lvlText}${shinyIcon}
            </div>`;
        }).join('');

        list.querySelectorAll('.piw-pokemon-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.dataset.name;
                if (selectedPokemon.includes(name)) {
                    selectedPokemon = selectedPokemon.filter(n => n !== name);
                } else {
                    selectedPokemon.push(name);
                }
                GM_setValue('piw_selectedPokemon', selectedPokemon);
                renderSelectedTags();
                renderPokemonList(document.getElementById('piw-search')?.value || '');
            });
        });
    }

    // Marca pokémons que têm shiny usando a tabela fixa
    function markShinyAvailable() {
        for (const c of creatures) {
            if (SHINY_SPECIES_IDS.has(c.pokeId)) {
                shinyAvailable.add(c.name.toLowerCase());
            }
        }
        GM_log('[AutoHunt] ✨ Shiny disponíveis:', shinyAvailable.size);
        renderPokemonList(document.getElementById('piw-search')?.value || '');
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

        try {
            // Busca rotas do mapa
            const markersResp = await fetch('/api/game/map-markers');
            if (markersResp.ok) {
                const data = await markersResp.json();
                routes = (data.hunts || []).filter(h => h.slug !== 'cerulean');
                GM_log('[AutoHunt] Rotas carregadas:', routes.length);
            }
        } catch(e) {
            GM_log('[AutoHunt] Erro ao buscar map-markers:', e);
        }
    }

    // ========== DETECTAR ROTA ATUAL ==========
    function detectRoute() {
        // Procura no DOM elementos que contenham o nome da rota
        const candidates = document.querySelectorAll(
            '[class*="route"] a, [class*="location"], [class*="area"], .piw-route-src'
        );
        for (const el of candidates) {
            const t = (el.textContent || '').trim();
            if (t && t.length < 40 && !/loading/i.test(t) && !/menu/i.test(t)) {
                currentRoute = t.split('(')[0].trim();
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
                        renderPokemonList(document.getElementById('piw-search')?.value || '');
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
        if (shinyOnlyMode) return;
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

    // Polling para detectar rota
    setInterval(() => { detectRoute(); syncUI(); }, 3000);

    // ========== WEBSOCKET INTERCEPTION ==========
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
        try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.type) {
                socket = this;
            }
        } catch(e) {}
        return origSend.call(this, data);
    };

    // Intercepta WebSocket para detectar capturas, slug da rota e pokémon líder
    const origOnMessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
        get: function() { return origOnMessage.get.call(this); },
        set: function(handler) {
            const wrappedHandler = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    // Detecta slug da rota (field-init)
                    if (data && data.type === 'field-init' && data.slug) {
                        const wasCity = isCity();
                        currentSlug = data.slug;
                        currentRoute = data.name || data.slug;
                        // Se entrou em cidade, reseta contadores
                        if (!wasCity && isCity()) {
                            killCount = 0;
                            captureCount = 0;
                            GM_log('[AutoHunt] Entrou em cidade, contadores resetados.');
                        }
                        GM_log('[AutoHunt] Rota detectada:', currentRoute, '(' + currentSlug + ')');
                        syncUI();
                    }
                    // Detecta captura bem-sucedida
                    if (data && data.type === 'catch-result') {
                        if (data.success === true && enabled) {
                            if (!busy) {
                                captureCount++;
                                GM_log('[AutoHunt] Captura! Total:', captureCount);
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
                                                renderPokemonList(document.getElementById('piw-search')?.value || '');
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
                        } else {
                            GM_log('[AutoHunt] Captura falhou');
                        }
                    }
                    // Detecta lista de pokémons (líder + shiny)
                    if (data && data.type === 'pokes' && data.list) {
                        detectShinyFromPokes(data.list);
                        updateLeader(data.list);
                    }
                } catch(e) {}
                if (handler) handler.call(this, event);
            };
            origOnMessage.set.call(this, wrappedHandler);
        }
    });

    // Detecta novos shinies comparando a lista anterior
    function detectShinyFromPokes(pokeList) {
        const currentShinies = pokeList.filter(p => p.shiny);
        const newShinyIds = currentShinies
            .filter(p => !lastPokesList.some(old => old.id === p.id && old.shiny))
            .map(p => p.id);

        if (newShinyIds.length > 0) {
            for (const shiny of currentShinies.filter(p => newShinyIds.includes(p.id))) {
                shinyCount++;
                GM_log('[AutoHunt] ✨ NOVO SHINY CAPTURADO!', shiny.name, '(total:', shinyCount + ')');
            }
            syncUI();
            // Se está no modo shiny-only, reseta contadores e troca
            if (shinyOnlyMode && !busy) {
                GM_log('[AutoHunt] Modo shiny-only: trocando de rota...');
                doSwitch();
            }
        }

        // Atualiza a lista anterior
        lastPokesList = pokeList.map(p => ({ id: p.id, shiny: p.shiny, name: p.name }));

        // Atualiza contagem total de shinies
        const totalShinies = currentShinies.length;
        if (totalShinies !== shinyCount) {
            shinyCount = totalShinies;
            syncUI();
        }
    }

    // Atualiza o pokémon líder a partir da lista
    function updateLeader(pokeList) {
        const team = pokeList.filter(p => p.team).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
        const leader = team.find(p => p.leader) ?? team[0];
        if (leader) {
            const newName = leader.name;
            const newTypes = [leader.type1, leader.type2].filter(Boolean);
            if (newName !== leaderName || JSON.stringify(newTypes) !== JSON.stringify(leaderTypes)) {
                leaderName = newName;
                leaderTypes = newTypes;
                GM_log('[AutoHunt] Líder detectado:', leaderName, '(' + leaderTypes.join('/') + ')');
                syncUI();
                renderPokemonList(document.getElementById('piw-search')?.value || '');
            }
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

                    // Busca a rota nos dados do mapa
                    const routeData = routes.find(r => r.name?.toLowerCase() === pokemon.toLowerCase());
                    if (!routeData) continue;

                    // Se tem área, clica na aba do mapa correto
                    if (routeData.area) {
                        const areaTabs = document.querySelectorAll('button.map-area');
                        for (const tab of areaTabs) {
                            const tabText = tab.textContent?.toLowerCase() || '';
                            const areaName = routeData.area.toLowerCase();
                            if (tabText.includes(areaName) || tabText.includes('outland') && areaName === 'outland') {
                                GM_log('[AutoHunt] Clicando aba:', tab.textContent.trim());
                                tab.click();
                                await sleep(600);
                                break;
                            }
                        }
                    }

                    // Agora procura o marcador na área atual
                    const markers = document.querySelectorAll('button.hunt-marker');
                    for (const marker of markers) {
                        const nameEl = marker.querySelector('.hunt-name');
                        if (!nameEl) continue;
                        const name = nameEl.textContent.trim();
                        const isHere = marker.classList.contains('here');
                        if (name.toLowerCase() === pokemon.toLowerCase() && !isHere) {
                            // Se mudou de pokémon, zera contadores
                            if (huntingPokemon !== pokemon) {
                                killCount = 0;
                                captureCount = 0;
                                huntingPokemon = pokemon;
                                // Reseta contadores individuais deste pokémon
                                const slug = pokemon.toLowerCase().replace(/\s+/g, '-');
                                GM_setValue('piw_kills_' + slug, 0);
                                GM_setValue('piw_captures_' + slug, 0);
                                GM_log('[AutoHunt] Novo pokémon:', pokemon, '- contadores resetados.');
                            }
                            GM_log('[AutoHunt] Clicando rota:', name, '(pokemon selecionado)');
                            marker.click();
                            currentRoute = name;
                            found = true;
                            break;
                        }
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
            if (document.querySelector('.game-root, .game-canvas-host, [class*="game-"]')) {
                clearInterval(check);
                setTimeout(async () => {
                    await fetchGameData();
                    buildPanel();
                    detectRoute();
                    syncUI();
                    // Pede a lista de pokémons após 6 segundos para detectar o líder
                    setTimeout(() => {
                        if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'pokes-get' }));
                            GM_log('[AutoHunt] Solicitando lista de pokémons');
                        }
                    }, 6000);
                    GM_log('[AutoHunt] Painel criado');
                }, 4000);
            }
        }, 600);
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();

    GM_log('[AutoHunt] Carregado v0.11.0. Kills:', KILL_TARGET, 'Capturas:', CAPTURE_TARGET);
})();
