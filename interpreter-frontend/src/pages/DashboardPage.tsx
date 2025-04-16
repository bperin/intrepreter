import React from "react";
import DashboardLayout from "../components/DashboardLayout";
import ConversationList from "../components/ConversationList";
import ChatInterface from "../components/ChatInterface";
import ActionStream from "../components/ActionStream";
import { ConversationProvider } from "../context/ConversationContext";
import { ActionProvider } from "../context/ActionContext";

const DashboardPage: React.FC = () => {
    return (
        <ConversationProvider>
            <ActionProvider>
                <DashboardLayout leftColumnContent={<ConversationList />} middleColumnContent={<ChatInterface />} rightColumnContent={<ActionStream />} />
            </ActionProvider>
        </ConversationProvider>
    );
};

export default DashboardPage;
