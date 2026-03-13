/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect } from "react";
import { UnityContext } from "react-unity-webgl";
import { useLocation } from "react-router";
import { io, Socket } from "socket.io-client";
import { toast } from "react-toastify";
import { config } from "./config";
import {
  UserType,
  BettedUserType,
  GameHistory,
  ContextType,
  ContextDataType,
  MsgUserType,
  GameBetLimit,
  UserStatusType,
  GameStatusType,
  LoadingType,
  SeedDetailsType,
  unityContext as sharedUnityContext,
  init_state as sharedInitState,
  init_userInfo,
} from "./utils/interfaces";

export interface PlayerType {
  auto: boolean;
  betted: boolean;
  cashouted: boolean;
  betAmount: number;
  cashAmount: number;
  target: number;
}

const Context = React.createContext<ContextType>(null!);

const socket: Socket = io(process.env.REACT_APP_API_URL || "http://localhost:5000", {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  timeout: 20000,
  forceNew: false
});

export const callCashOut = (at: number, index: "f" | "s") => {
  let data = { type: index, endTarget: at };
  socket.emit("cashOut", data);
};

let fIncreaseAmount = 0;
let fDecreaseAmount = 0;
let sIncreaseAmount = 0;
let sDecreaseAmount = 0;

let newState;
let newBetState;

export const Provider = ({ children }: any) => {
  const token = new URLSearchParams(useLocation().search).get("cert");
  const [state, setState] = React.useState<ContextDataType>(sharedInitState);
  const [userInfo, setUserInfo] = React.useState<UserType>(init_userInfo);
  const [msgData, setMsgData] = React.useState<MsgUserType[]>([]);
  const [msgTab, setMsgTab] = React.useState<boolean>(false);
  const [msgReceived, setMsgReceived] = React.useState<boolean>(false);
  const [platformLoading, setPlatformLoading] = React.useState<boolean>(false);
  const [errorBackend, setErrorBackend] = React.useState<boolean>(false);
  const [secure, setSecure] = React.useState<boolean>(false);
  const [userSeedText, setUserSeedText] = React.useState<string>("");
  const [globalUserInfo, setGlobalUserInfo] = React.useState<UserType>(init_userInfo);
  const [fLoading, setFLoading] = React.useState<boolean>(false);
  const [sLoading, setSLoading] = React.useState<boolean>(false);

  newState = state;
  const [unity, setUnity] = React.useState({
    unityState: false,
    unityLoading: false,
    currentProgress: 0,
  });
  const [gameState, setGameState] = React.useState({
    currentNum: "0",
    currentSecondNum: 0,
    GameState: "",
    time: 0,
  });

  const [bettedUsers, setBettedUsers] = React.useState<BettedUserType[]>([]);
  const update = (attrs: Partial<ContextDataType>) => {
    setState({ ...state, ...attrs });
  };
  const [previousHand, setPreviousHand] = React.useState<UserType[]>([]);
  const [history, setHistory] = React.useState<number[]>([]);
  const [userBetState, setUserBetState] = React.useState<UserStatusType>({
    fbetState: false,
    fbetted: false,
    sbetState: false,
    sbetted: false,
  });
  newBetState = userBetState;
  const [rechargeState, setRechargeState] = React.useState(false);
  const [currentTarget, setCurrentTarget] = React.useState(0);
  const updateUserBetState = (attrs: Partial<UserStatusType>) => {
    setUserBetState({ ...userBetState, ...attrs });
  };

  const [betLimit, setBetLimit] = React.useState<GameBetLimit>({
    maxBet: 1000,
    minBet: 1,
  });
  React.useEffect(function () {
    // Unity loading event handlers
    sharedUnityContext.on("loaded", () => {
      console.log("✅ Unity WebGL loaded successfully");
      setUnity({
        currentProgress: 100,
        unityLoading: true,
        unityState: true,
      });
    });

    sharedUnityContext.on("error", (error) => {
      console.error("🔴 Unity WebGL error:", error);
      setUnity({
        currentProgress: 0,
        unityLoading: false,
        unityState: false,
      });
    });

    sharedUnityContext.on("GameController", function (message) {
      console.log("🎮 Unity message:", message);
      if (message === "Ready") {
        setUnity({
          currentProgress: 100,
          unityLoading: true,
          unityState: true,
        });
      }
    });

    sharedUnityContext.on("progress", (progression) => {
      const currentProgress = progression * 100;
      console.log(`📊 Unity loading progress: ${currentProgress.toFixed(1)}%`);
      if (progression === 1) {
        setUnity({ currentProgress, unityLoading: true, unityState: true });
      } else {
        setUnity({ currentProgress, unityLoading: false, unityState: false });
      }
    });

    return () => sharedUnityContext.removeAllEventListeners();
  }, []);

  React.useEffect(() => {
    // Socket connection event handlers
    socket.on("connect", () => {
      console.log("✅ Connected to backend server");
      setErrorBackend(false);
      socket.emit("enterRoom", { token });
    });

    socket.on("disconnect", () => {
      console.log("❌ Disconnected from backend server");
      setErrorBackend(true);
    });

    socket.on("connect_error", (error) => {
      console.error("🔴 Connection error:", error);
      setErrorBackend(true);
    });

    socket.on("bettedUserInfo", (bettedUsers: BettedUserType[]) => {
      setBettedUsers(bettedUsers);
    });

    socket.on("myBetState", (user: UserType) => {
      setUserBetState(prev => ({
        ...prev,
        fbetState: false,
        fbetted: user.f.betted,
        sbetState: false,
        sbetted: user.s.betted,
      }));
    });

    socket.on("myInfo", (user: UserType) => {
      setState(prev => ({
        ...prev,
        userInfo: {
          ...prev.userInfo,
          balance: user.balance,
          userType: user.userType,
          userName: user.userName,
        },
      }));
    });

    socket.on("history", (history: any) => {
      setHistory(history);
    });

    socket.on("gameState", (gameState: GameStatusType) => {
      setGameState(gameState);
    });

    socket.on("previousHand", (previousHand: UserType[]) => {
      setPreviousHand(previousHand);
    });

    socket.on("finishGame", (user: UserType) => {
      let attrs = newState;
      let fauto = attrs.userInfo.f.auto;
      let sauto = attrs.userInfo.s.auto;
      let fbetAmount = attrs.userInfo.f.betAmount;
      let sbetAmount = attrs.userInfo.s.betAmount;
      let betStatus = newBetState;
      attrs.userInfo = user;
      attrs.userInfo.f.betAmount = fbetAmount;
      attrs.userInfo.s.betAmount = sbetAmount;
      attrs.userInfo.f.auto = fauto;
      attrs.userInfo.s.auto = sauto;
      if (!user.f.betted) {
        betStatus.fbetted = false;
        if (attrs.userInfo.f.auto) {
          if (user.f.cashouted) {
            fIncreaseAmount += user.f.cashAmount;
            if (attrs.finState && attrs.fincrease - fIncreaseAmount <= 0) {
              attrs.userInfo.f.auto = false;
              betStatus.fbetState = false;
              fIncreaseAmount = 0;
            } else if (
              attrs.fsingle &&
              attrs.fsingleAmount <= user.f.cashAmount
            ) {
              attrs.userInfo.f.auto = false;
              betStatus.fbetState = false;
            } else {
              attrs.userInfo.f.auto = true;
              betStatus.fbetState = true;
            }
          } else {
            fDecreaseAmount += user.f.betAmount;
            if (attrs.fdeState && attrs.fdecrease - fDecreaseAmount <= 0) {
              attrs.userInfo.f.auto = false;
              betStatus.fbetState = false;
              fDecreaseAmount = 0;
            } else {
              attrs.userInfo.f.auto = true;
              betStatus.fbetState = true;
            }
          }
        }
      }
      if (!user.s.betted) {
        betStatus.sbetted = false;
        if (user.s.auto) {
          if (user.s.cashouted) {
            sIncreaseAmount += user.s.cashAmount;
            if (attrs.sinState && attrs.sincrease - sIncreaseAmount <= 0) {
              attrs.userInfo.s.auto = false;
              betStatus.sbetState = false;
              sIncreaseAmount = 0;
            } else if (
              attrs.ssingle &&
              attrs.ssingleAmount <= user.s.cashAmount
            ) {
              attrs.userInfo.s.auto = false;
              betStatus.sbetState = false;
            } else {
              attrs.userInfo.s.auto = true;
              betStatus.sbetState = true;
            }
          } else {
            sDecreaseAmount += user.s.betAmount;
            if (attrs.sdeState && attrs.sdecrease - sDecreaseAmount <= 0) {
              attrs.userInfo.s.auto = false;
              betStatus.sbetState = false;
              sDecreaseAmount = 0;
            } else {
              attrs.userInfo.s.auto = true;
              betStatus.sbetState = true;
            }
          }
        }
      }
      update(attrs);
      setUserBetState(betStatus);
    });

    socket.on("getBetLimits", (betAmounts: { max: number; min: number }) => {
      setBetLimit({ maxBet: betAmounts.max, minBet: betAmounts.min });
    });

    socket.on("recharge", () => {
      setRechargeState(true);
    });

    socket.on("error", (data) => {
      setUserBetState(prev => ({
        ...prev,
        [`${data.index}betted`]: false,
      }));
      toast.error(data.message);
    });

    socket.on("success", (data) => {
      toast.success(data);
    });
    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("myBetState");
      socket.off("myInfo");
      socket.off("history");
      socket.off("gameState");
      socket.off("previousHand");
      socket.off("finishGame");
      socket.off("getBetLimits");
      socket.off("recharge");
      socket.off("error");
      socket.off("success");
    };
  }, [socket]);

  React.useEffect(() => {
    let attrs = state;
    let betStatus = userBetState;
    if (gameState.GameState === "BET") {
      if (betStatus.fbetState) {
        if (state.userInfo.f.auto) {
          if (state.fautoCound > 0) attrs.fautoCound -= 1;
          else {
            attrs.userInfo.f.auto = false;
            betStatus.fbetState = false;
            return;
          }
        }
        let data = {
          betAmount: state.userInfo.f.betAmount,
          target: state.userInfo.f.target,
          type: "f",
          auto: state.userInfo.f.auto,
        };
        if (attrs.userInfo.balance - state.userInfo.f.betAmount < 0) {
          toast.error("Your balance is not enough");
          betStatus.fbetState = false;
          betStatus.fbetted = false;
          return;
        }
        attrs.userInfo.balance -= state.userInfo.f.betAmount;
        socket.emit("playBet", data);
        betStatus.fbetState = false;
        betStatus.fbetted = true;
        // update(attrs);
        setUserBetState(betStatus);
      }
      if (betStatus.sbetState) {
        if (state.userInfo.s.auto) {
          if (state.sautoCound > 0) attrs.sautoCound -= 1;
          else {
            attrs.userInfo.s.auto = false;
            betStatus.sbetState = false;
            return;
          }
        }
        let data = {
          betAmount: state.userInfo.s.betAmount,
          target: state.userInfo.s.target,
          type: "s",
          auto: state.userInfo.s.auto,
        };
        if (attrs.userInfo.balance - state.userInfo.s.betAmount < 0) {
          toast.error("Your balance is not enough");
          betStatus.sbetState = false;
          betStatus.sbetted = false;
          return;
        }
        attrs.userInfo.balance -= state.userInfo.s.betAmount;
        socket.emit("playBet", data);
        betStatus.sbetState = false;
        betStatus.sbetted = true;
        // update(attrs);
        setUserBetState(betStatus);
      }
    }
  }, [gameState.GameState, userBetState.fbetState, userBetState.sbetState]);

  const getMyBets = async () => {
    try {
      const response = await fetch(`${config.api}/my-info`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: state.userInfo.userName }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status) {
          update({ myBets: data.data as GameHistory[] });
        }
      } else {
        console.error("Error:", response.statusText);
      }
    } catch (error) {
      console.log("getMyBets", error);
    }
  };

  useEffect(() => {
    if (gameState.GameState === "BET") getMyBets();
  }, [gameState.GameState]);

  const updateUserInfo = (attrs: Partial<UserType>) => {
    setUserInfo((prev) => ({ ...prev, ...attrs }));
  };
  const handleGetSeed = () => {/* implement or stub */};
  const handleGetSeedOfRound = async (id: number): Promise<SeedDetailsType> => {
    try {
      const response = await fetch(`${config.api}/game/seed/${id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userInfo.token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return data;
      } else {
        throw new Error('Failed to fetch seed details');
      }
    } catch (error) {
      console.error('Error fetching seed details:', error);
      // Return default data structure to prevent errors
      return {
        createdAt: new Date().toISOString(),
        serverSeed: '',
        seedOfUsers: [],
        flyDetailID: id
      };
    }
  };
  const handlePlaceBet = () => {/* implement or stub */};
  const toggleMsgTab = () => setMsgTab((prev) => !prev);
  const handleChangeUserSeed = (seed: string) => {/* implement or stub */};

  return (
    <Context.Provider
      value={{
        ...state,
        ...gameState,
        ...userBetState,
        ...betLimit,
        userInfo,
        state, // add state for consumers expecting state
        socket,
        msgData,
        msgTab,
        msgReceived,
        setMsgReceived,
        platformLoading,
        errorBackend,
        unityState: unity.unityState,
        unityLoading: unity.unityLoading,
        currentProgress: unity.currentProgress,
        globalUserInfo,
        bettedUsers,
        previousHand,
        history,
        rechargeState,
        secure,
        myUnityContext: sharedUnityContext,
        userSeedText,
        currentTarget,
        fLoading,
        setFLoading,
        sLoading,
        setSLoading,
        setCurrentTarget,
        update: (attrs) => setState((prev) => ({ ...prev, ...attrs })),
        updateUserInfo,
        getMyBets,
        updateUserBetState,
        setMsgData,
        handleGetSeed,
        handleGetSeedOfRound,
        handlePlaceBet,
        toggleMsgTab,
        handleChangeUserSeed,
      }}
    >
      {children}
    </Context.Provider>
  );
};

export default Context;
