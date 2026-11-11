# PROMPTS.md — marcos do cc-cockpit

Cole um por vez no Claude Code, dentro da pasta do projeto (com o CLAUDE.md na raiz). Só avance quando o teste do marco passar.

---

## Marco 0 — Setup
```
Leia o CLAUDE.md. Crie o esqueleto do monorepo (server/, web/, hooks/, shared/) com TypeScript estrito, Vite no web e um script `npm run dev` que sobe tudo. Crie config.json de exemplo (config.example.json) e coloque config.json no .gitignore. Inicialize o git. Não implemente funcionalidades ainda. No final, diga como testar.
```

## Marco 1 — Terminal persistente (1 sessão)
```
Implemente o Marco 1: um terminal no navegador ligado a um PTY real.
- server: node-pty abrindo o shell da config (pwsh) no cwd da config; manter o PTY vivo independente do navegador.
- Terminal virtual no servidor com @xterm/headless + @xterm/addon-serialize. Ao um cliente conectar (WebSocket, protocolo tipado em shared/), enviar o snapshot da tela e depois o fluxo ao vivo.
- web: xterm.js (+ fit e webgl addons) conectado ao WebSocket, redimensionando o PTY.
Teste esperado: abrir no PC, rodar `claude`, fechar a aba, reabrir e ver a mesma tela viva, com o Claude ainda funcionando.
Se o node-pty não compilar, siga a regra do CLAUDE.md.
```

## Marco 2 — Rede segura + várias sessões
```
Implemente o Marco 2.
1) Segurança: escutar só na interface Tailscale (ou localhost + tailscale serve), token no primeiro acesso salvo em cookie HttpOnly, checagem de Origin no WebSocket. Documente no README como configurar o Tailscale e testar do celular.
2) Várias sessões: criar, listar, renomear e encerrar sessões (nome + pasta escolhida entre as favoritas da config). Tela inicial com cards (nome, pasta, estado placeholder, última linha do terminal via terminal virtual). Tocar no card abre o terminal da sessão. Cada PTY recebe a env CCC_SESSION_ID.
Teste esperado: duas sessões em pastas diferentes rodando ao mesmo tempo, acessadas do celular via Tailscale.
```

## Marco 3 — UX mobile
```
Implemente o Marco 3, focado em Android/Chrome.
- Barra de teclas fixa acima do teclado (use visualViewport): Esc, Ctrl+C, Tab, setas, Enter, 1, 2, 3, y, n.
- Modo Compose: textarea multilinha + botão enviar (envia como paste seguido de Enter) + snippets configuráveis (/clear, /compact, "continue"). Alternar entre Terminal e Compose com um botão.
- Ajustar fonte e layout para tela pequena; evitar zoom e scroll indesejado.
Teste esperado: conduzir uma conversa inteira com o Claude Code só pelo celular, incluindo aprovar uma permissão.
```

## Marco 4 — Hooks e estados
```
Implemente o Marco 4.
- Antes de codar, consulte a documentação atual de hooks do Claude Code e confirme nomes de eventos e formato do payload.
- hooks/: script em Node que lê o JSON do stdin e faz POST em 127.0.0.1 (endpoint separado, com segredo), incluindo CCC_SESSION_ID. Se a env não existir, sai sem fazer nada.
- Servidor: converter eventos em estados (idle, working, waiting_permission, done, error), enviar aos clientes por WebSocket e gravar tudo num log de eventos (SQLite).
- Cards do dashboard refletem o estado ao vivo.
- Gere o trecho de configuração de hooks para eu colar no ~/.claude/settings.json, mas NÃO altere o arquivo; me mostre o diff e peça confirmação.
Teste esperado: o card muda de estado enquanto o Claude trabalha, pede permissão e termina.
```

## Marco 5 — Temas, efeitos e sons
```
Implemente o Marco 5.
- Sistema de temas como dados: Neon/cyberpunk, CRT retrô, Pixel/RPG. Cada tema define variáveis CSS, fonte, tema do xterm, efeitos de fundo (shader/canvas) e pacote de sons. Troca em um toque, lembrada entre visitas.
- Efeitos por evento: enviar prompt (pulso), ferramenta em uso (faíscas/scanline por tipo), pedido de permissão (card pisca + vibração), concluído (explosão/confete temático + vibração), erro (glitch).
- Sons gerados com WebAudio, um pacote por tema, um som por evento; destravar áudio no primeiro toque; botão de mudo.
- Controles: nível de qualidade dos efeitos e "reduzir efeitos".
Cuide do desempenho no celular.
```

## Marco 6 — Estatísticas
```
Implemente o Marco 6: tela de estatísticas alimentada pelo log de eventos SQLite (ver lista completa no CLAUDE.md, item 10).
Leia o transcript_path dos hooks para extrair tokens e estimar custo.
Visualizações no estilo do tema ativo: cards de resumo, séries por dia, heatmap hora × dia, ranking de ferramentas e arquivos, linha do tempo das sessões, comparação entre projetos, filtro por período e por projeto.
Comece pelas métricas de tempo e ferramentas, depois tokens e heatmap.
```

## Marco 7 — PWA e serviço
```
Implemente o Marco 7.
- PWA instalável no Chrome Android (manifest, ícones, service worker simples, tela cheia).
- Rodar o servidor como serviço do Windows (Agendador de Tarefas ou NSSM) iniciando com o PC, com log em arquivo.
- Ao reiniciar, recriar as sessões salvas (nome + pasta) rodando `claude --continue`.
- README final: instalação, Tailscale, hooks, solução de problemas.
```
