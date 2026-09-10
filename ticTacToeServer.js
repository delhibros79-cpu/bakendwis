const roomGames = new Map();

function getInitialState(roomId) {
    return {
        roomId,
        players: { X: null, O: null },
        board: Array(9).fill(null),
        turn: 'X',
        status: 'waiting',
        winner: null,
        winningLine: null
    };
}

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (let i = 0; i < lines.length; i++) {
        const [a, b, c] = lines[i];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { winner: board[a], winningLine: lines[i] };
        }
    }

    if (!board.includes(null)) {
        return { winner: 'draw', winningLine: null };
    }

    return null;
}

function registerTicTacToeHandlers(io, socket, db, admin) {
    socket.on('tic_tac_toe_get_state', (data) => {
        const { roomId } = data;
        let gameState = roomGames.get(roomId);
        if (!gameState) {
            gameState = getInitialState(roomId);
            roomGames.set(roomId, gameState);
        }
        socket.emit('tic_tac_toe_state_update', gameState);
    });

    socket.on('tic_tac_toe_join', (data) => {
        const { roomId, player, symbol } = data; // symbol: 'X' or 'O'
        let gameState = roomGames.get(roomId);
        if (!gameState) {
            gameState = getInitialState(roomId);
            roomGames.set(roomId, gameState);
        }

        if (gameState.status !== 'waiting' && gameState.status !== 'finished') {
            socket.emit('tic_tac_toe_error', { message: 'Game already in progress.' });
            return;
        }

        // If game was finished, joining restarts it
        if (gameState.status === 'finished') {
            gameState = getInitialState(roomId);
            roomGames.set(roomId, gameState);
        }

        // Prevent taking a seat if already taken
        if (gameState.players[symbol] !== null) {
            socket.emit('tic_tac_toe_error', { message: `Seat ${symbol} is already taken.` });
            return;
        }

        // Prevent joining both seats
        const otherSymbol = symbol === 'X' ? 'O' : 'X';
        if (gameState.players[otherSymbol]?.uid === player.uid) {
            socket.emit('tic_tac_toe_error', { message: 'You are already in the game.' });
            return;
        }

        gameState.players[symbol] = player;

        if (gameState.players['X'] && gameState.players['O']) {
            gameState.status = 'playing';
            gameState.turn = 'X';
            gameState.board = Array(9).fill(null);
            gameState.winner = null;
            gameState.winningLine = null;
        }

        io.to(roomId).emit('tic_tac_toe_state_update', gameState);
    });

    socket.on('tic_tac_toe_make_move', (data) => {
        const { roomId, index, uid } = data;
        let gameState = roomGames.get(roomId);

        if (!gameState || gameState.status !== 'playing') {
            socket.emit('tic_tac_toe_error', { message: 'Game is not in progress.' });
            return;
        }

        if (gameState.board[index] !== null) {
            socket.emit('tic_tac_toe_error', { message: 'Cell is already taken.' });
            return;
        }

        const currentTurnPlayer = gameState.players[gameState.turn];
        if (!currentTurnPlayer || currentTurnPlayer.uid !== uid) {
            socket.emit('tic_tac_toe_error', { message: 'Not your turn.' });
            return;
        }

        gameState.board[index] = gameState.turn;

        const result = checkWinner(gameState.board);
        if (result) {
            gameState.status = 'finished';
            gameState.winner = result.winner;
            gameState.winningLine = result.winningLine;
        } else {
            gameState.turn = gameState.turn === 'X' ? 'O' : 'X';
        }

        io.to(roomId).emit('tic_tac_toe_state_update', gameState);
    });

    socket.on('tic_tac_toe_leave', (data) => {
        const { roomId, uid } = data;
        let gameState = roomGames.get(roomId);
        if (!gameState) return;

        let playerLeft = false;
        if (gameState.players['X']?.uid === uid) {
            gameState.players['X'] = null;
            playerLeft = true;
        } else if (gameState.players['O']?.uid === uid) {
            gameState.players['O'] = null;
            playerLeft = true;
        }

        if (playerLeft) {
            // If the game was running, the other player wins by default, or we reset.
            if (gameState.status === 'playing') {
                gameState.status = 'finished';
                gameState.winner = gameState.players['X'] ? 'X' : (gameState.players['O'] ? 'O' : 'draw');
            } else if (gameState.status === 'finished') {
                // If finished and someone leaves, just clear their seat or let the state persist until next join.
            }
            io.to(roomId).emit('tic_tac_toe_state_update', gameState);
        }
    });
}

module.exports = {
    registerTicTacToeHandlers
};
