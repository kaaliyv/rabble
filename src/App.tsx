import { useState, useEffect } from "react";
import Home from "./components/Home/Home";
import Player from "./components/Player/Player";
import HostScreen from "./components/HostScreen/HostScreen";
import type { RoomState, Room, User } from "./types/game";

type AppState = 
  | { view: 'home' }
  | { view: 'game'; room: Room; user: User };

export default function App() {
  const [appState, setAppState] = useState<AppState>({ view: 'home' });
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [error, setError] = useState<string>('');
  const [isReconnecting, setIsReconnecting] = useState<boolean>(true);

  const SESSION_KEY = 'rabble_session';

  const saveSession = (code: string, userId: number) => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ code, userId }));
    } catch {
      // Ignore storage errors
    }
  };

  const clearSession = () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  const loadSession = (): { code: string; userId: number } | null => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.code || !parsed?.userId) return null;
      return { code: String(parsed.code), userId: Number(parsed.userId) };
    } catch {
      return null;
    }
  };

  const exitToHome = (message?: string) => {
    clearSession();
    setError(message ?? '');
    setRoomState(null);
    setAppState({ view: 'home' });
    setWs((prev) => {
      prev?.close();
      return null;
    });
  };

  const handleLeaveGame = () => exitToHome();

  useEffect(() => {
    let active = true;

    const attemptReconnect = async () => {
      const session = loadSession();
      if (!session) {
        if (active) setIsReconnecting(false);
        return;
      }

      try {
        const response = await fetch('/api/room/reconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: session.code, userId: session.userId })
        });

        if (!response.ok) {
          const data = await response.json();
          clearSession();
          if (active) setError(data.error || 'Failed to reconnect');
          return;
        }

        const data = await response.json();
        if (!active) return;
        setAppState({
          view: 'game',
          room: data.room,
          user: data.user
        });
      } catch (error) {
        clearSession();
        if (active) setError('Failed to reconnect');
      } finally {
        if (active) setIsReconnecting(false);
      }
    };

    attemptReconnect();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (appState.view !== 'game') return;

    const { room, user } = appState;

    // Connect to WebSocket
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const websocket = new WebSocket(
      `${wsProtocol}://${window.location.host}/ws?roomId=${room.id}&userId=${user.id}`
    );

    websocket.onopen = () => {
      console.log('WebSocket connected');
      setError('');
    };

    websocket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'room_state') {
        setRoomState(msg.payload);
      } else if (msg.type === 'game_started') {
        setRoomState(msg.payload.state);
      } else if (msg.type === 'error') {
        setError(msg.payload.message);
      } else if (msg.type === 'game_cancelled') {
        exitToHome(msg.payload?.message || 'Game was cancelled');
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection error');
    };

    websocket.onclose = () => {
      console.log('WebSocket disconnected');
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, [appState]);

  const handleCreateRoom = async (nickname: string) => {
    try {
      const response = await fetch('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname })
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to create room');
        return;
      }

      const data = await response.json();
      saveSession(data.room.code, data.user.id);
      setAppState({
        view: 'game',
        room: data.room,
        user: data.user
      });
    } catch (error) {
      console.error('Error creating room:', error);
      setError('Failed to create room');
    }
  };

  const handleJoinRoom = async (code: string, nickname: string) => {
    try {
      const response = await fetch('/api/room/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, nickname })
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to join room');
        return;
      }

      const data = await response.json();
      saveSession(data.room.code, data.user.id);
      setAppState({
        view: 'game',
        room: data.room,
        user: data.user
      });
    } catch (error) {
      console.error('Error joining room:', error);
      setError('Failed to join room');
    }
  };

  if (appState.view === 'home') {
    return (
      <>
        <Home onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} />
        {isReconnecting && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-white/90 text-slate-800 px-6 py-3 rounded-xl shadow-lg border border-slate-200">
            Reconnecting to your game...
          </div>
        )}
        {error && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-xl shadow-lg">
            {error}
          </div>
        )}
      </>
    );
  }

  if (!roomState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  const { user } = appState;
  const isHost = user.is_host;

  return (
    <div className="min-h-screen">
      {isHost ? (
        <HostScreen roomState={roomState} ws={ws} onLeave={handleLeaveGame} />
      ) : (
        <Player roomState={roomState} currentUser={user} ws={ws} onLeave={handleLeaveGame} />
      )}

      {/* Error toast */}
      {error && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-xl shadow-lg z-50">
          {error}
        </div>
      )}
    </div>
  );
}
