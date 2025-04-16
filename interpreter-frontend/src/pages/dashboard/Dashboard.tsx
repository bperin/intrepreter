import { useConversation } from "../../context/ConversationContext";
import { useState, useEffect } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import ConversationList from "../../components/ConversationList";
import ChatInterface from "../../components/ChatInterface";
import styled from "styled-components";

// Temporary styled button for direct testing
const DebugButton = styled.button`
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 15px;
    background-color: red;
    color: white;
    z-index: 9999;
    border: none;
    border-radius: 4px;
    cursor: pointer;
`;

const Dashboard: React.FC = () => {
    // Removing all modal-related state and handlers since it's now in DashboardLayout
    const [debugCounter, setDebugCounter] = useState(0);
    
    // Debug effect to log renders
    useEffect(() => {
        console.log("[Dashboard] Rendering component, debug counter:", debugCounter);
    }, [debugCounter]);

    return (
        <>
            <DashboardLayout 
                leftColumnContent={<ConversationList />}
                middleColumnContent={<ChatInterface />}
                rightColumnContent={<div>Actions & Notes Panel</div>}
            />
            
            {/* Emergency debug button */}
            <DebugButton onClick={() => {
                console.log("[EMERGENCY] Debug button clicked!");
                setDebugCounter(count => count + 1);
            }}>
                DEBUG ({debugCounter})
            </DebugButton>
        </>
    );
};

export default Dashboard; 