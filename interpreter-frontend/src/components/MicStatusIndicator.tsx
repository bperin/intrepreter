import React, { useState, useEffect } from "react";
import styled, { keyframes } from "styled-components";
import { Theme } from "../theme";
import { FiMic, FiMicOff, FiLock, FiAlertTriangle } from "react-icons/fi";

type ThemedProps = { theme: Theme };
type MicStatus = "idle" | "listening" | "permission_needed" | "denied" | "error";

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4); }
  70% { box-shadow: 0 0 0 8px rgba(255, 255, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
`;

const StatusContainer = styled.div<ThemedProps>`
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.sm};
    padding: ${({ theme }) => theme.spacing.sm};
    cursor: pointer;
    border-radius: ${({ theme }) => theme.borderRadius.md};
    transition: background-color 0.2s ease;

    &:hover {
        background-color: ${({ theme }) => theme.colors.background.hover};
    }
`;

const IconWrapper = styled.div<{ $status: MicStatus } & ThemedProps>`
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: ${({ $status, theme }) => {
        if ($status === "idle" || $status === "permission_needed") return theme.colors.text.secondary;
        return "white";
    }};
    background-color: ${({ $status, theme }) => {
        switch ($status) {
            case "listening":
                return theme.colors.status.success;
            case "permission_needed":
                return theme.colors.background.tertiary;
            case "denied":
            case "error":
                return theme.colors.status.error;
            case "idle":
            default:
                return theme.colors.background.secondary;
        }
    }};
    animation: ${({ $status }) => ($status === "listening" ? pulse : "none")} 2s infinite;
    transition: background-color 0.2s ease;

    svg {
        width: 16px;
        height: 16px;
    }
`;

const MicStatusIndicator: React.FC = () => {
    const [status, setStatus] = useState<MicStatus>("idle");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        const checkPermissions = async () => {
            try {
                const permissionStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
                if (permissionStatus.state === "granted") {
                    setStatus("idle");
                } else if (permissionStatus.state === "prompt") {
                    setStatus("permission_needed");
                } else {
                    setStatus("denied");
                    setErrorMsg("Microphone access was denied. Please enable it in your browser settings.");
                }
                permissionStatus.onchange = () => {
                    if (permissionStatus.state === "granted") setStatus("idle");
                    else if (permissionStatus.state === "prompt") setStatus("permission_needed");
                    else setStatus("denied");
                };
            } catch (err) {
                console.error("Permissions API error or not supported:", err);
                setStatus("permission_needed");
            }
        };
        checkPermissions();
    }, []);

    const requestMicPermission = async () => {
        setErrorMsg(null);
        setStatus("permission_needed");
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log("Microphone permission granted.");
        } catch (err) {
            console.error("Error requesting microphone permission:", err);
            if (err instanceof Error) {
                if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                    setErrorMsg("Microphone access was denied. Please enable it in your browser settings.");
                } else {
                    setStatus("error");
                    setErrorMsg(`Error accessing microphone: ${err.message}`);
                }
            } else {
                setStatus("error");
                setErrorMsg("An unknown error occurred while accessing the microphone.");
            }
        }
    };

    const handleClick = () => {
        if (status === "permission_needed" || status === "denied" || status === "error") {
            requestMicPermission();
        } else if (status === "idle") {
            setStatus("listening");
            console.log("Start listening...");
        } else if (status === "listening") {
            setStatus("idle");
            console.log("Stop listening...");
        }
    };

    const getStatusInfo = (): { icon: React.ReactElement; text: string } => {
        switch (status) {
            case "listening":
                return { icon: <FiMic />, text: "Listening..." };
            case "permission_needed":
                return { icon: <FiLock />, text: "Click to Allow Mic" };
            case "denied":
                return { icon: <FiMicOff />, text: "Mic Denied - Click to Request" };
            case "error":
                return { icon: <FiAlertTriangle />, text: "Mic Error - Click to Retry" };
            case "idle":
            default:
                return { icon: <FiMic />, text: "Mic Idle - Click to Listen" };
        }
    };

    const { icon, text } = getStatusInfo();

    return (
        <StatusContainer onClick={handleClick} title={errorMsg || text}>
            <IconWrapper $status={status}>{icon}</IconWrapper>
        </StatusContainer>
    );
};

export default MicStatusIndicator;
