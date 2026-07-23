// ==UserScript==
// @name         Poke Idle World - Auto Hunt Switcher
// @namespace    http://tampermonkey.net/
// @version      0.62.0
// @description  Escolha os pokémons que quer caçar e ele troca automaticamente de rota.
// @author       You
// @match        https://poke.idleworld.online/play
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
    let leaderPokeId = 0;
    let leaderLevel = 0;
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
    position: fixed; bottom: 76px; right: 10px; z-index: 2147483647;
    background: #111422; border: 1px solid #3d5280; border-radius: 16px;
    color: #e0e4ef; font: 13px/1.4 'Segoe UI',sans-serif;
    width: 340px; min-width: 300px; box-shadow: 0 8px 40px rgba(0,0,0,.6), 0 0 0 1px rgba(91,127,255,.15);
    backdrop-filter: blur(6px); user-select: none;
    max-height: 85vh; overflow: hidden;
}
.piw-panel-inner { padding: 16px 14px; overflow-y: auto; max-height: calc(85vh - 42px); scrollbar-width: thin; scrollbar-color: #2d3548 transparent; }
.piw-panel-inner::-webkit-scrollbar { width: 5px; }
.piw-panel-inner::-webkit-scrollbar-track { background: transparent; }
.piw-panel-inner::-webkit-scrollbar-thumb { background: #2d3548; border-radius: 3px; }
.piw-panel { padding-top: 0 !important; }
.piw-panel h3 { margin: 0 0 8px; padding: 10px 14px; font-size: 15px; color: #e0e4ef; font-weight: 700; letter-spacing: .3px; cursor: move; display: flex; justify-content: space-between; align-items: center; user-select: none; background: linear-gradient(135deg,#1a1f35,#252d48); border-radius: 16px 16px 0 0; border-bottom: 1px solid #2d3650; }
.piw-panel h3:active { cursor: move; }

.piw-card {
    background: #181d2c; border: 1px solid #3d5280; border-radius: 12px;
    padding: 10px 12px; margin-bottom: 8px;
}
.piw-card-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px;
    color: #5a6888; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #3d5280;
}

.piw-panel .piw-btn {
    background: #1a1f2e; border: 1px solid #2d3548; color: #e0e4ef; border-radius: 10px;
    padding: 6px 14px; cursor: pointer; font-size: 12px; transition: all .15s; font-weight: 500;
}
.piw-panel .piw-btn:hover { background: #3d5280; border-color: #3d4a6a; }
.piw-panel .piw-btn:active { background: #2d3548; }
.piw-panel .piw-btn.piw-btn-primary { background: linear-gradient(135deg,#5b7fff,#4a6adf); border: none; color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(91,127,255,.3); }
.piw-panel .piw-btn.piw-btn-primary:hover { background: linear-gradient(135deg,#6b8fff,#5a7aef); box-shadow: 0 4px 16px rgba(91,127,255,.4); }

.piw-panel .piw-stat { font-size: 15px; font-weight: 700; text-align: center; margin: 1px 0; font-variant-numeric: tabular-nums; }
.piw-panel .piw-stat.piw-kills { color: #f0c040; }
.piw-panel .piw-stat.piw-captures { color: #4ade80; }

.piw-panel .piw-progress { height: 8px; background: #131720; border-radius: 5px; overflow: hidden; margin: 3px 0; border: 1px solid #1e2433; }
.piw-panel .piw-progress-bar { height: 100%; transition: width .3s; border-radius: 5px; }
.piw-bar-kills { background: linear-gradient(90deg,#f0c040,#d4a017); }
.piw-bar-caps { background: linear-gradient(90deg,#4ade80,#22c55e); }

.piw-panel .piw-dual-progress { display: flex; gap: 8px; margin: 4px 0; }
.piw-panel .piw-dual-progress-item { flex: 1; }
.piw-panel .piw-dual-progress-label { font-size: 10px; color: #9aa3bf; text-align: center; margin-bottom: 2px; font-weight: 500; }
.piw-panel .piw-dual-progress .piw-progress { height: 8px; }

.piw-panel .piw-route { font-size: 11px; color: #9aa3bf; text-align: center; }
.piw-panel .piw-leader { font-size: 11px; color: #c084fc; text-align: center; padding: 2px 0; }
.piw-panel .piw-shiny { font-size: 11px; color: #f0c040; text-align: center; padding: 2px 0; }

.piw-panel .piw-label { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 12px; color: #c8cddc; }
.piw-panel .piw-label input[type=number] {
    background: #131720; border: 1px solid #2d3548; border-radius: 8px;
    color: #e0e4ef; padding: 5px 10px; font-size: 12px; width: 80px;
}
.piw-panel .piw-label input[type=number]:focus { outline: none; border-color: #5b7fff; }
.piw-panel .piw-label input[type=checkbox] { width: auto; accent-color: #5b7fff; }

.piw-panel .piw-row { display: flex; justify-content: space-between; align-items: center; gap: 4px; }

.piw-panel .piw-selected-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; min-height: 20px; }
.piw-panel .piw-tag {
    background: #14211c; border: 1px solid #2d5a3d; border-radius: 8px;
    padding: 3px 10px; font-size: 10px; color: #4ade80; font-weight: 500;
    display: flex; align-items: center; gap: 5px;
}
.piw-panel .piw-tag-remove { cursor: pointer; color: #f87171; font-weight: bold; font-size: 12px; }
.piw-panel .piw-tag-remove:hover { color: #ff4444; }

.piw-panel .piw-hint { font-size: 12px; color: #9aa3bf; text-align: center; margin-top: 4px; }

.piw-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 600;
    letter-spacing: .3px; text-transform: uppercase;
}
.piw-badge-running { background: rgba(74,222,128,.12); color: #4ade80; border: 1px solid rgba(74,222,128,.2); }
.piw-badge-paused { background: rgba(248,113,113,.12); color: #f87171; border: 1px solid rgba(248,113,113,.2); }

.piw-panel .piw-city { font-size: 11px; color: #f0c040; text-align: center; padding: 2px 0; }
.piw-panel .piw-close { cursor: pointer; color: #5a6380; font-size: 16px; line-height: 1; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; transition: all .15s; }
.piw-panel .piw-close:hover { color: #f87171; background: rgba(248,113,113,.1); }
.piw-panel .piw-search {
    background: #131720; border: 1px solid #2d3548; border-radius: 8px;
    color: #e0e4ef; padding: 6px 10px; font-size: 12px; width: 100%;
    box-sizing: border-box; margin-bottom: 4px;
}
.piw-panel .piw-search::placeholder { color: #4a5270; }
.piw-panel .piw-pokemon-list {
    max-height: 120px; overflow-y: auto; border: 1px solid #3d5280;
    border-radius: 8px; margin-bottom: 6px; background: #131720;
}
.piw-panel .piw-pokemon-item {
    padding: 4px 8px; cursor: pointer; font-size: 12px;
    display: flex; align-items: center; gap: 6px;
}
.piw-panel .piw-pokemon-item:hover { background: #1a1f2e; }
.piw-panel .piw-pokemon-item.selected { background: #14211c; color: #4ade80; }
.piw-panel .piw-pokemon-item .piw-check { width: 14px; text-align: center; }
.piw-panel .piw-filter-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 11px; }
.piw-panel .piw-filter-row input[type=checkbox] { width: auto; accent-color: #c084fc; }
.piw-panel .piw-pagination { display: flex; justify-content: center; align-items: center; gap: 6px; margin: 4px 0; font-size: 11px; }
.piw-panel .piw-pagination .piw-btn { padding: 2px 8px; font-size: 10px; }
.piw-panel .piw-pagination .piw-page-info { color: #5a6380; }
.piw-panel .piw-pokemon-item .piw-shiny-icon { color: #f0c040; margin-left: 4px; }
.piw-panel .piw-btns-row { display: flex; gap: 6px; margin-bottom: 4px; }
.piw-panel .piw-btns-row .piw-btn { flex: 1; font-size: 10px; padding: 3px 6px; }

#piw-reopen {
    position: fixed; top: 5px; right: 10px; z-index: 2147483647;
    width: 34px; height: 34px; border-radius: 10px;
    background: #151924; border: 1px solid #2d3548;
    color: #e0e4ef; font-size: 14px; cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,.5); display: none;
    align-items: center; justify-content: center; transition: all .15s;
}
#piw-reopen:hover { background: #1a1f2e; border-color: #3d4a6a; }
.piw-modal-overlay {
    position: fixed; inset: 0; z-index: 2147483647;
    background: transparent; display: block;
    pointer-events: none;
}
.piw-modal { pointer-events: auto; }
.piw-modal {
    background: #111422; border: 1px solid #3d5280; border-radius: 16px;
    width: 800px; height: 600px;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 12px 50px rgba(0,0,0,.7), 0 0 0 1px rgba(91,127,255,.15);
    position: fixed; top: calc(50vh - 300px); left: calc(50vw - 400px);
    min-width: 500px; min-height: 400px;
}
.piw-modal-resize { position: absolute; bottom: 0; right: 0; width: 18px; height: 18px; cursor: nwse-resize; border-radius: 0 0 16px 0; opacity: .3; }
.piw-modal-resize:hover { opacity: .7; }
.piw-modal-resize::after { content: ''; position: absolute; bottom: 4px; right: 4px; width: 8px; height: 8px; border-right: 2px solid #5a6380; border-bottom: 2px solid #5a6380; }
.piw-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; border-bottom: 1px solid #3d5280;
    background: linear-gradient(180deg, #1c2233 0%, #151924 100%);
    cursor: move; user-select: none;
}
.piw-modal-header h3 { margin: 0; font-size: 16px; color: #e0e4ef; font-weight: 700; letter-spacing: .3px; user-select: none; flex: 1; }
.piw-modal-header .piw-modal-close {
    cursor: pointer; color: #5a6380; font-size: 20px; background: none;
    border: none; padding: 4px 8px; line-height: 1; border-radius: 6px;
    transition: all .15s;
}
.piw-modal-header .piw-modal-close:hover { color: #f87171; background: rgba(248,113,113,.1); }
.piw-modal-toolbar {
    display: flex; gap: 10px; padding: 12px 20px; border-bottom: 1px solid #1e2433;
    align-items: center; flex-wrap: wrap; background: #131720;
}
.piw-modal-toolbar input[type=text] {
    flex: 1; min-width: 150px; background: #1a1f2e; border: 1px solid #2d3548;
    border-radius: 10px; color: #e0e4ef; padding: 8px 14px; font-size: 13px;
    transition: border-color .15s;
}
.piw-modal-toolbar input[type=text]:focus { outline: none; border-color: #5b7fff; }
.piw-modal-toolbar input[type=text]::placeholder { color: #4a5270; }
.piw-modal-toolbar select {
    background: #1a1f2e; border: 1px solid #2d3548; border-radius: 10px;
    color: #e0e4ef; padding: 8px 12px; font-size: 12px; cursor: pointer;
    transition: border-color .15s;
}
.piw-modal-toolbar select:focus { outline: none; border-color: #5b7fff; }
.piw-modal-toolbar label {
    display: flex; align-items: center; gap: 5px; font-size: 12px; color: #9aa3bf; cursor: pointer;
    padding: 6px 12px; border-radius: 10px; border: 1px solid #2d3548; background: #1a1f2e;
    transition: all .15s;
}
.piw-modal-toolbar label:hover { border-color: #5b7fff; color: #e0e4ef; }
.piw-modal-toolbar label input { accent-color: #5b7fff; }
.piw-modal-toolbar .piw-modal-count {
    font-size: 11px; color: #9aa3bf; white-space: nowrap;
}
.piw-modal-body {
    flex: 1; overflow-y: auto; padding: 16px 20px;
}
.piw-modal-body::-webkit-scrollbar { width: 6px; }
.piw-modal-body::-webkit-scrollbar-track { background: transparent; }
.piw-modal-body::-webkit-scrollbar-thumb { background: #2d3548; border-radius: 3px; }
.piw-modal-body::-webkit-scrollbar-thumb:hover { background: #3d4558; }
.piw-pokedex-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
    gap: 10px;
}
.piw-poke-card {
    background: #1a1f2e; border: 1px solid #3d5280; border-radius: 12px;
    padding: 10px 6px; cursor: pointer; text-align: center; transition: all .2s;
    position: relative;
}
.piw-poke-card:hover { border-color: #3d4a6a; background: #1e2438; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,.3); }
.piw-poke-card.selected { border-color: #4ade80; background: #14211c; box-shadow: 0 0 12px rgba(74,222,128,.15); }
.piw-poke-card .piw-poke-img {
    width: 56px; height: 56px; image-rendering: pixelated;
    margin: 0 auto 6px; display: block;
}
.piw-poke-card .piw-poke-num {
    font-size: 9px; color: #9aa3bf;
}
.piw-poke-card .piw-poke-name {
    font-size: 11px; color: #e0e4ef; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.piw-poke-card .piw-poke-level {
    font-size: 9px; color: #f0c040;
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
    position: absolute; top: 5px; left: 5px; font-size: 10px;
}
.piw-modal-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 20px; border-top: 1px solid #3d5280;
    background: #131720;
}
.piw-modal-footer .piw-btns-row { display: flex; gap: 8px; }
.piw-modal-footer .piw-btn {
    background: #1a1f2e; border: 1px solid #2d3548; color: #e0e4ef;
    border-radius: 8px; padding: 7px 16px; cursor: pointer; font-size: 12px;
    transition: all .15s;
}
.piw-modal-footer .piw-btn:hover { background: #3d5280; border-color: #3d4a6a; }
.piw-modal-footer .piw-selected-info { font-size: 13px; color: #9aa3bf; }
.piw-modal-footer .piw-btn-apply {
    background: linear-gradient(135deg, #5b7fff, #4a6adf); border: none;
    color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(91,127,255,.3);
}
.piw-modal-footer .piw-btn-apply:hover { background: linear-gradient(135deg, #6b8fff, #5a7aef); box-shadow: 0 4px 16px rgba(91,127,255,.4); }
.piw-type-badge {
    display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px;
    color: #fff; font-weight: 600; letter-spacing: .3px; text-transform: uppercase;
    margin: 0 2px; vertical-align: middle;
}
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
            <h3>Auto Hunt <span style="display:flex;align-items:center;gap:6px"><span style="display:flex;align-items:center;gap:2px;font-size:11px;color:#9aa3bf">🔍 <input type="range" id="piw-opacity" min="40" max="100" value="${GM_getValue('piw_opacity',100)}" style="width:60px;accent-color:#5b7fff" title="${GM_getValue('piw_opacity',100)}%"></span><span id="piw-minimize" class="piw-close" title="Minimizar">−</span> <span id="piw-close-panel" class="piw-close" title="Fechar painel">✕</span></span></h3>
            <div class="piw-panel-inner">
                <div style="display:flex;gap:8px;justify-content:center;margin:2px 0 6px">
                <button class="piw-btn" id="piw-play" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:7px 18px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(34,197,94,.3)" title="Iniciar caça">▶ Play</button>
                <button class="piw-btn" id="piw-stop" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;padding:7px 18px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(239,68,68,.3)" title="Parar e voltar pra cidade">■ Stop</button>
                <button class="piw-btn" id="piw-reset" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;padding:7px 12px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(99,102,241,.3)" title="Resetar contadores">↻ Reset</button>
                </div>
            <div style="text-align:center;margin-bottom:6px"><div id="piw-status"></div></div>
            <div id="piw-minimized-view" style="display:none;text-align:center">
                <div id="piw-start-hunt-mini" style="display:none;margin:4px 0">
                    <button class="piw-btn" id="piw-start-btn-mini" style="background:linear-gradient(135deg,#5b7fff,#4a6adf);color:#fff;padding:6px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:700;box-shadow:0 2px 8px rgba(91,127,255,.3)">Começar caça</button>
                </div>
                <div class="piw-card">
                    <div class="piw-leader" id="piw-leader-mini"></div>
                    <div class="piw-shiny" id="piw-shiny-mini">✨ Shiny: 0</div>
                    <div class="piw-stat piw-kills" id="piw-kills-mini">Abates: 0 / 100</div>
                    <div class="piw-stat piw-captures" id="piw-caps-mini">Capturas: 0 / 1</div>
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
                    <div class="piw-route" id="piw-route-mini" style="display:none">—</div>
                    <div id="piw-hunting-display-mini" style="text-align:center;margin-top:6px"></div>
                </div>
            </div>
            <div id="piw-full-content">
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
                <div class="piw-card-label">Pokémon</div>
                <button class="piw-btn piw-btn-primary" id="piw-open-pokedex" style="width:100%;padding:7px 0;font-size:12px;font-weight:600">Selecionar Pokémon</button>
                <div class="piw-selected-tags" id="piw-selected-tags"></div>
                <div class="piw-hint" id="piw-hint">Nenhum selecionado - troca qualquer rota</div>
            </div>
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

        const opacitySlider = panel.querySelector('#piw-opacity');
        if (opacitySlider) {
            panel.style.opacity = opacitySlider.value / 100;
            opacitySlider.addEventListener('input', () => {
                const val = opacitySlider.value / 100;
                panel.style.opacity = val;
                opacitySlider.title = opacitySlider.value + '%';
                GM_setValue('piw_opacity', parseInt(opacitySlider.value));
                const modalEl = document.querySelector('.piw-modal');
                if (modalEl) modalEl.style.opacity = val;
            });
        }

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

        // Botão Pokédex
        panel.querySelector('#piw-open-pokedex').addEventListener('click', () => openPokedexModal());

        // Botão Começar caça (full view) - removido, agora é Play/Stop

        document.body.appendChild(panel);

        const savedPos = GM_getValue('piw_panelPos', null);
        if (savedPos) {
            panel.style.left = savedPos.left;
            panel.style.top = savedPos.top;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }

        const title = panel.querySelector('h3');
        let isDragging = false, offsetX, offsetY;
        title.addEventListener('mousedown', (e) => {
            if (e.target.closest('.piw-close') || e.target.id === 'piw-opacity' || e.target.closest('#piw-opacity')) return;
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
                const typeBadges = leaderTypes.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'};font-size:9px;padding:1px 6px">${t}</span>`).join(' ');
                leaderEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:10px">${imgUrl ? `<div style="width:52px;height:52px;border:2px solid #3d4a6a;border-radius:10px;background:#131720;display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${imgUrl}" style="width:44px;height:44px;image-rendering:pixelated" onerror="this.onerror=null;this.src='${fallbackUrl}'"></div>` : ''}<div style="text-align:left"><div style="display:flex;align-items:baseline;gap:6px"><span style="color:#e0e4ef;font-weight:700;font-size:15px">${leaderName}</span><span style="color:#9aa3bf;font-size:12px">Lv ${leaderLevel || '?'}</span></div><div style="display:flex;gap:4px;margin-top:3px">${typeBadges}</div></div></div>`;
            } else {
                leaderEl.textContent = '—';
            }
        }
        if (shinyEl) {
            shinyEl.textContent = `✨ Shiny: ${shinyCount}`;
        }
        const leaderMini = document.getElementById('piw-leader-mini');
        if (leaderMini) {
            if (leaderName) {
                const imgUrl = getPokemonImageUrl(leaderPokeId, leaderName, true);
                const fallbackUrl = getPokemonImageUrl(leaderPokeId, leaderName, false);
                const typeBadges = leaderTypes.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'};font-size:8px;padding:1px 5px">${t}</span>`).join(' ');
                leaderMini.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px">${imgUrl ? `<div style="width:38px;height:38px;border:2px solid #3d4a6a;border-radius:8px;background:#131720;display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${imgUrl}" style="width:32px;height:32px;image-rendering:pixelated" onerror="this.onerror=null;this.src='${fallbackUrl}'"></div>` : ''}<div style="text-align:left"><div style="display:flex;align-items:baseline;gap:5px"><span style="color:#e0e4ef;font-weight:700;font-size:13px">${leaderName}</span><span style="color:#9aa3bf;font-size:10px">Lv ${leaderLevel || '?'}</span></div><div style="display:flex;gap:3px;margin-top:2px">${typeBadges}</div></div></div>`;
            } else {
                leaderMini.textContent = '—';
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
        const huntEl = document.getElementById('piw-hunting-display');
        const huntElMini = document.getElementById('piw-hunting-display-mini');
        const huntHTML = huntingPokemon ? (() => {
            const creature = creatures.find(c => c.name?.toLowerCase() === huntingPokemon.toLowerCase());
            const types = [creature?.type1, creature?.type2].filter(Boolean);
            const typeBadges = types.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'};font-size:9px;padding:1px 6px">${t}</span>`).join(' ');
            return `<div style="display:flex;align-items:center;justify-content:center;gap:8px"><span style="color:#e0e4ef;font-weight:700;font-size:15px">${huntingPokemon}</span><span style="display:flex;gap:4px">${typeBadges}</span></div>`;
        })() : '';
        if (huntEl) huntEl.innerHTML = huntHTML;
        if (huntElMini) huntElMini.innerHTML = huntHTML;
        saveState();
    }

    // ========== POKEMON SELECTOR ==========
    function renderSelectedTags() {
        const container = document.getElementById('piw-selected-tags');
        const hint = document.getElementById('piw-hint');
        if (!container) return;
        container.innerHTML = selectedPokemon.map((name, idx) =>
            `<span class="piw-tag" draggable="true" data-idx="${idx}" style="cursor:move">${name} <span class="piw-tag-remove" data-name="${name}">&times;</span></span>`
        ).join('');
        if (hint) {
            hint.textContent = selectedPokemon.length === 0
                ? 'Nenhum selecionado - troca qualquer rota'
                : `${selectedPokemon.length} selecionado(s)`;
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
        const NAME_MAP = {
            'nidoranfe': 'Nidoran Female',
            'nidoranma': 'Nidoran Male',
            'farfetchd': 'Farfetchd',
            'farfetch': 'Farfetchd',
            'mrmime': 'Mr. Mime',
            'hooh': 'Ho-oh',
        };
        const pokemonMap = new Map();
        routes.forEach(r => {
            if (r.name) {
                const key = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                const mappedName = NAME_MAP[key] || r.name;
                const creature = creatures.find(c => c.name?.toLowerCase() === mappedName.toLowerCase())
                    || creatures.find(c => c.name?.toLowerCase().replace(/[^a-z0-9]/g, '') === key);
                pokemonMap.set(key, {
                    name: r.name,
                    level: r.level || 0,
                    pokeId: creature?.pokeId || 0,
                    type1: creature?.type1 || '',
                    type2: creature?.type2 || '',
                });
            }
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
        pokemonArray.sort((a, b) => a.pokeId - b.pokeId || a.level - b.level);
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

    // ========== POKEDEX MODAL ==========
    let pokedexModalFilter = '';
    let pokedexModalTypeFilter = '';
    let pokedexModalShinyOnly = false;

    function getPokemonImageUrl(pokeId, name, animated = false) {
        if (!pokeId || pokeId <= 0) return '';
        if (pokeId < 10000) {
            if (animated && pokeId <= 649) {
                return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${pokeId}.gif`;
            }
            return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokeId}.png`;
        }
        let bestBase = null;
        for (const c of creatures) {
            if (c.pokeId >= 10000 || !c.name) continue;
            if (name?.toLowerCase().includes(c.name.toLowerCase())) {
                if (!bestBase || c.name.length > bestBase.name.length) bestBase = c;
            }
        }
        if (bestBase) {
            if (animated && bestBase.pokeId <= 649) {
                return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${bestBase.pokeId}.gif`;
            }
            return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${bestBase.pokeId}.png`;
        }
        return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokeId}.png`;
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
                        ${Object.keys(TYPE_COLORS).sort().map(t => `<option value="${t}" ${pokedexModalTypeFilter===t?'selected':''}>${t[0]+t.slice(1).toLowerCase()}</option>`).join('')}
                    </select>
                    <label><input type="checkbox" id="piw-pokedex-shiny" ${pokedexModalShinyOnly?'checked':''}> Shiny</label>
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

        const savedModalSize = GM_getValue('piw_modalSize', null);
        if (savedModalSize) {
            modal.style.width = savedModalSize.w;
            modal.style.height = savedModalSize.h;
            modal.style.left = `calc(50vw - ${parseInt(savedModalSize.w)/2}px)`;
            modal.style.top = `calc(50vh - ${parseInt(savedModalSize.h)/2}px)`;
        }
        const savedModalPos = GM_getValue('piw_modalPos', null);
        if (savedModalPos) {
            modal.style.left = savedModalPos.left;
            modal.style.top = savedModalPos.top;
        }

        let modalDragging = false, modalOx, modalOy;
        modalHeader.addEventListener('mousedown', (e) => {
            if (e.target.closest('.piw-modal-close')) return;
            modalDragging = true;
            modalOx = e.clientX - modal.getBoundingClientRect().left;
            modalOy = e.clientY - modal.getBoundingClientRect().top;
            modal.style.transform = 'none';
            modal.style.left = modal.getBoundingClientRect().left + 'px';
            modal.style.top = modal.getBoundingClientRect().top + 'px';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!modalDragging) return;
            modal.style.left = (e.clientX - modalOx) + 'px';
            modal.style.top = (e.clientY - modalOy) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (modalDragging) {
                modalDragging = false;
                GM_setValue('piw_modalPos', { left: modal.style.left, top: modal.style.top });
            }
        });

        const modalResize = document.createElement('div');
        modalResize.className = 'piw-modal-resize';
        modal.appendChild(modalResize);
        let modalResizing = false, mrsX, mrsY, mrsW, mrsH;
        modalResize.addEventListener('mousedown', (e) => {
            modalResizing = true;
            mrsX = e.clientX; mrsY = e.clientY;
            mrsW = modal.offsetWidth; mrsH = modal.offsetHeight;
            e.preventDefault(); e.stopPropagation();
        });
        document.addEventListener('mousemove', (e) => {
            if (!modalResizing) return;
            modal.style.width = Math.max(500, mrsW + e.clientX - mrsX) + 'px';
            modal.style.height = Math.max(400, mrsH + e.clientY - mrsY) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (modalResizing) {
                modalResizing = false;
                GM_setValue('piw_modalSize', { w: modal.style.width, h: modal.style.height });
            }
        });

        const grid = document.getElementById('piw-pokedex-grid');
        const searchInput = document.getElementById('piw-pokedex-search');
        const typeFilter = document.getElementById('piw-pokedex-type-filter');
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
                        ${types.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#888'}">${t}</span>`).join('')}
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
                    html += weakTo.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'}">${t}</span>`).join(' ');
                    html += `<br><span style="color:#4ade80;font-weight:600">🛡 Resistente a:</span> `;
                    html += superEff.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'}">${t}</span>`).join(' ');
                    hintEl.innerHTML = html;
                    hintEl.style.display = 'block';
                } else {
                    hintEl.style.display = 'none';
                }
            }
        });
        shinyCheck.addEventListener('change', () => { pokedexModalShinyOnly = shinyCheck.checked; renderPokedex(); });

        document.getElementById('piw-pokedex-select-all').addEventListener('click', () => {
            const filter = searchInput.value.toLowerCase();
            const typeF = typeFilter.value;
            const shinyOnly = shinyCheck.checked;
            let list = getFilteredPokemonList('');
            if (filter) list = list.filter(p => p.name.toLowerCase().includes(filter) || String(p.pokeId).includes(filter));
            if (typeF) list = list.filter(p => p.type1 === typeF || p.type2 === typeF);
            if (shinyOnly) list = list.filter(p => shinyAvailable.has(p.name.toLowerCase()));
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
            renderPokemonList(document.getElementById('piw-search')?.value || '');
            pokedexModalTypeFilter = '';
            pokedexModalFilter = '';
            overlay.remove();
        });

        document.getElementById('piw-pokedex-close').addEventListener('click', () => { pokedexModalTypeFilter = ''; pokedexModalFilter = ''; overlay.remove(); });

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

    setInterval(() => {
        if (leaderName) {
            const domLevel = getLeaderLevelFromDOM();
            if (domLevel !== null && domLevel !== leaderLevel) {
                leaderLevel = domLevel;
                syncUI();
            }
        }
    }, 3000);

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

    function getLeaderLevelFromDOM() {
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
            const txt = el.textContent?.trim();
            if (txt && txt.match(/^Lv\.?\s*\d+$/) && el.offsetParent !== null) {
                const m = txt.match(/(\d+)/);
                if (m) {
                    const num = parseInt(m[1]);
                    if (num > 0 && num < 10000) return num;
                }
            }
        }
        const teamSlots = document.querySelectorAll('[class*="team"] [class*="slot"], [class*="pokemon"]');
        for (const slot of teamSlots) {
            if (!slot.offsetParent) continue;
            const txt = slot.textContent;
            const m = txt.match(/Lv\.?\s*(\d+)/);
            if (m) {
                const num = parseInt(m[1]);
                if (num > 0 && num < 10000) return num;
            }
        }
        return null;
    }

    // Atualiza o pokémon líder a partir da lista
    function updateLeader(pokeList) {
        const team = pokeList.filter(p => p.team).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
        const leader = team.find(p => p.leader) ?? team[0];
        if (leader) {
            const newName = leader.name;
            const newTypes = [leader.type1, leader.type2].filter(Boolean);
            let newLevel = leader.level || 0;
            const domLevel = getLeaderLevelFromDOM();
            if (domLevel !== null) newLevel = domLevel;
            const newPokeId = leader.pokeId || (() => {
                const c = creatures.find(c => c.name?.toLowerCase() === newName.toLowerCase());
                return c?.pokeId || 0;
            })();
            GM_log('[AutoHunt] Leader raw:', JSON.stringify({ name: leader.name, level: leader.level, domLevel, pokeId: leader.pokeId }));
            const changed = newName !== leaderName || JSON.stringify(newTypes) !== JSON.stringify(leaderTypes) || newLevel !== leaderLevel;
            leaderName = newName;
            leaderTypes = newTypes;
            leaderPokeId = newPokeId;
            leaderLevel = newLevel;
            syncUI();
            if (changed) {
                GM_log('[AutoHunt] Líder detectado:', leaderName, '(' + leaderTypes.join('/') + ') Lv', leaderLevel);
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
