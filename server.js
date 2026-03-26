const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('TicTacToe+ OK');
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function makeCode() {
  return Math.random().toString(36).substr(2,5).toUpperCase();
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, skip) {
  [...room.players, ...room.spectators].forEach(ws => {
    if (ws !== skip && ws.readyState === 1) ws.send(JSON.stringify(msg));
  });
}

const WL = { 3:3, 5:4, 7:5, 9:6 };

function checkWin(board, n) {
  const wl = WL[n] || 3;
  const chk = l => {
    const s = board[l[0]]; if (!s) return null;
    if (l.every(i => board[i] === s)) return { winner: s, line: l };
    return null;
  };
  for (let r=0;r<n;r++) for (let c=0;c<=n-wl;c++) { const v=chk(Array.from({length:wl},(_,k)=>r*n+c+k)); if(v) return v; }
  for (let c=0;c<n;c++) for (let r=0;r<=n-wl;r++) { const v=chk(Array.from({length:wl},(_,k)=>(r+k)*n+c)); if(v) return v; }
  for (let r=0;r<=n-wl;r++) for (let c=0;c<=n-wl;c++) { const v=chk(Array.from({length:wl},(_,k)=>(r+k)*n+(c+k))); if(v) return v; }
  for (let r=0;r<=n-wl;r++) for (let c=wl-1;c<n;c++) { const v=chk(Array.from({length:wl},(_,k)=>(r+k)*n+(c-k))); if(v) return v; }
  return null;
}

wss.on('connection', ws => {
  ws.roomCode = null; ws.role = null; ws.symbol = null;

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const room = rooms.get(ws.roomCode);

    if (msg.type === 'create') {
      const code = makeCode();
      rooms.set(code, {
        players: [ws], spectators: [],
        state: { inProgress:false, board:[], current:'X', size:msg.size||3, mode:msg.gameMode||'classic', scores:{X:0,O:0,D:0} }
      });
      ws.roomCode=code; ws.role='player'; ws.symbol='X';
      send(ws, { type:'created', code, symbol:'X', size:msg.size||3, gameMode:msg.gameMode||'classic' });
    }

    else if (msg.type === 'join') {
      const code = msg.code?.toUpperCase();
      const r = rooms.get(code);
      if (!r) { send(ws, {type:'error', msg:'Raum nicht gefunden!'}); return; }
      if (r.players.length < 2) {
        r.players.push(ws); ws.roomCode=code; ws.role='player'; ws.symbol='O';
        send(ws, {type:'joined', code, symbol:'O', size:r.state.size, gameMode:r.state.mode});
        send(r.players[0], {type:'opponent_joined'});
        broadcast(r, {type:'lobby_update', playerCount:r.players.length, spectatorCount:r.spectators.length});
      } else {
        r.spectators.push(ws); ws.roomCode=code; ws.role='spectator';
        send(ws, {type:'spectating', code, size:r.state.size, gameMode:r.state.mode, board:r.state.board, current:r.state.current, inProgress:r.state.inProgress, scores:r.state.scores});
        broadcast(r, {type:'spectator_joined', spectatorCount:r.spectators.length}, ws);
      }
    }

    else if (msg.type === 'start' && room) {
      const n = room.state.size;
      room.state.board = Array(n*n).fill('');
      room.state.current = 'X'; room.state.inProgress = true;
      broadcast(room, {type:'game_start', board:room.state.board, current:'X', size:n, gameMode:room.state.mode});
    }

    else if (msg.type === 'move' && room && room.state.inProgress) {
      if (ws.role !== 'player' || ws.symbol !== room.state.current) return;
      const i = msg.index;
      if (room.state.board[i] !== '') return;
      room.state.board[i] = room.state.current;
      const result = checkWin(room.state.board, room.state.size);
      if (result) {
        room.state.scores[result.winner]++; room.state.inProgress = false;
        broadcast(room, {type:'move', index:i, board:room.state.board, result:'win', winner:result.winner, line:result.line, scores:room.state.scores});
      } else if (room.state.board.every(c=>c)) {
        room.state.scores.D++; room.state.inProgress = false;
        broadcast(room, {type:'move', index:i, board:room.state.board, result:'draw', scores:room.state.scores});
      } else {
        room.state.current = room.state.current==='X'?'O':'X';
        broadcast(room, {type:'move', index:i, board:room.state.board, result:'continue', current:room.state.current});
      }
    }

    else if (msg.type === 'rematch' && room) {
      ws.wantsRematch = true;
      if (room.players.every(p=>p.wantsRematch)) {
        room.players.forEach(p=>p.wantsRematch=false);
        const n = room.state.size;
        room.state.board = Array(n*n).fill('');
        room.state.current = 'X'; room.state.inProgress = true;
        broadcast(room, {type:'game_start', board:room.state.board, current:'X', size:n, gameMode:room.state.mode});
      } else {
        broadcast(room, {type:'rematch_requested'}, ws);
      }
    }

    else if (msg.type === 'emoji' && room) {
      broadcast(room, {type:'emoji', emoji:msg.emoji, from:ws.symbol||'spectator'}, ws);
    }
  });

  ws.on('close', () => {
    const r = rooms.get(ws.roomCode); if (!r) return;
    if (ws.role === 'player') {
      r.players = r.players.filter(p=>p!==ws);
      if (r.players.length===0 && r.spectators.length===0) rooms.delete(ws.roomCode);
      else broadcast(r, {type:'player_left'});
    } else {
      r.spectators = r.spectators.filter(s=>s!==ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server on port ' + PORT));
