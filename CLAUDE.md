# CLAUDE.md — cc-cockpit

Painel web (PWA) pessoal para controlar sessões do Claude Code rodando no PC Windows do Pedro, pelo celular Android, de qualquer lugar via Tailscale. Foco: ficar **bonito, sonoro e rico em estatísticas**. Uso só pessoal por enquanto; publicar talvez depois.

## Contexto do usuário
- Pedro, dev Unity XR. Português (BR) na conversa; **código, nomes e commits em inglês**; comentários curtos.
- Prefere respostas curtas, sem enfeite. Explique só o necessário.
- PC: Windows, PowerShell 7 (`pwsh`) e 5.1 instalados, Git instalado. Celular: Android (Nothing Phone), Chrome.

## Arquitetura
```
cc-cockpit/
  server/   Node.js + TypeScript: Express, ws, node-pty, @xterm/headless, SQLite
  web/      Vite + TypeScript, sem framework pesado: xterm.js, WebAudio, Canvas/WebGL
  hooks/    scripts chamados pelos hooks do Claude Code (POST em localhost)
  shared/   tipos do protocolo WebSocket (fonte única)
  config.json   porta, shell, pastas favoritas, token (fora do git)
```

### Decisões fechadas
1. **Persistência:** o servidor mantém cada PTY vivo. O navegador só se anexa. Cada sessão tem um terminal virtual (`@xterm/headless` + `@xterm/addon-serialize`) no servidor. Ao reconectar, enviar **snapshot serializado**, nunca replay do buffer bruto. Tamanho do PTY = último cliente ativo.
2. **Shell:** `pwsh` nativo (config: `shell`), abrindo no `cwd` da sessão e rodando `claude`. Se o `claude` sair, o shell continua. Trocar por WSL depois deve ser só mudar a config.
3. **Entrada no celular, dois modos:** (a) Terminal: xterm com barra de teclas (Esc, Ctrl+C, Tab, setas, 1/2/3, y/n); (b) Compose: textarea multilinha (ditado por voz do teclado), botão enviar, snippets (`/clear`, `/compact`, "continue"). Usar `visualViewport` para a barra não ficar sob o teclado.
4. **Várias sessões simultâneas:** `Session = {id, name, cwd, pty, headlessTerm, state}`. Dashboard de cards com estado e preview da última linha. Cada PTY recebe env `CCC_SESSION_ID`.
5. **Eventos por hooks do Claude Code** (UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStop, SessionStart). Confirmar nomes e payload na documentação atual antes de implementar. O hook lê o JSON do stdin e faz POST em `127.0.0.1` com `CCC_SESSION_ID` e segredo. **Sem `CCC_SESSION_ID`, o hook não faz nada** (não afetar o Claude fora do app).
6. **Estados da sessão:** idle, working, waiting_permission, done, error.
7. **Rede/segurança:** servidor escuta só na interface Tailscale (ou localhost + `tailscale serve` para HTTPS). Nunca `0.0.0.0`. Token longo no primeiro acesso, guardado em cookie HttpOnly. Checar `Origin` no WebSocket. Endpoint dos hooks separado, só localhost, com segredo próprio. Sem dependências desnecessárias.
8. **Temas como dados** (CSS variables + config JSON): Neon/cyberpunk, CRT retrô, Pixel/RPG. Cada tema define cores, fonte, efeitos visuais e pacote de sons. Troca em um toque.
9. **Sons:** gerados com WebAudio (sem arquivos), um pacote por tema (8-bit, futurista, ambiente), temáticos. Áudio só destrava após um toque do usuário. Botão de mudo.
10. **Estatísticas:** log de eventos append-only em SQLite; tudo é derivado. Métricas: tempo trabalhando × esperando × ocioso (por sessão e projeto), tempo de resposta do usuário às permissões, prompts/dia, duração das tarefas, ranking de ferramentas, arquivos mais editados, linhas alteradas, tokens e custo estimado (lidos do `transcript_path`), heatmap hora × dia, linha do tempo de sessões, comparação entre projetos. O máximo possível.
11. **Sessões sobrevivem a queda de conexão e de aba**, não a reinício do PC: guardar nome e pasta para recriar com `claude --continue`. Rodar o servidor como serviço só no marco final.

### Fora de escopo (por enquanto)
Notificações push, XP/níveis/conquistas, multiusuário, WSL, app nativo.

## Convenções
- TypeScript estrito. Protocolo WebSocket tipado em `shared/`.
- Sem caminhos fixos no código; tudo na config.
- Efeitos e temas em módulos independentes.
- Commits pequenos e frequentes, mensagens em inglês.
- Desempenho no celular importa: efeitos devem ter nível de qualidade ajustável e opção de reduzir.

## Regras de trabalho para o Claude
- Entregar por marcos (ver `PROMPTS.md`). Um marco por vez; ao fim, dizer como testar.
- Perguntar antes de instalar ferramentas globais ou alterar configs fora do projeto (ex.: `~/.claude/settings.json`).
- Se o `node-pty` não compilar no Windows, tentar o fork com binários prontos (`@lydell/node-pty`) antes de pedir Build Tools do Visual Studio.
- Nunca expor o servidor fora do Tailscale. Nunca comitar `config.json` ou token.
- Respostas curtas. Mostrar só o que mudou e como testar.

## Comandos (preencher conforme o projeto evolui)
- `npm install` — instala todos os workspaces (shared, server, hooks, web)
- `npm run dev` — server (tsx watch) + web (Vite, proxy `/api` e `/ws` → server)
- `npm run typecheck` — `tsc` em todos os workspaces
- `npm run build` — typecheck + bundle: `server/dist`, `hooks/dist/cc-hook.mjs`, `web/dist`
- `npm start` — server de produção (serve `web/dist`)
- `npm run service -- install|start|stop|restart|status|logs|uninstall` — serviço via Agendador de Tarefas (`scripts/service.ps1`; `-AtStartup` = antes do logon, admin); log em `logs/server.log`
- `npm run icons` — regenera ícones PWA em `web/public/icons/`
- Sessões salvas em `data/sessions.json`; recriadas no start com `claude --resume <id>` / `--continue`
- Config: `config.json` na raiz (copiar de `config.example.json`); override com env `CCC_CONFIG`
- Celular: `tailscale serve --bg 7420` (prod) ou `--bg 5173` (dev); ver README
