import React from "react";
import DashboardLayout from "../components/DashboardLayout";
import ConversationList from "../components/ConversationList";
import ChatInterface from "../components/ChatInterface";
import ActionStream from "../components/ActionStream";
import { ConversationProvider } from "../context/ConversationContext";

const DashboardPage: React.FC = () => {
    return (
        <ConversationProvider>
            <DashboardLayout leftColumnContent={<ConversationList />} middleColumnContent={<ChatInterface />} rightColumnContent={<ActionStream />} />
        </ConversationProvider>
    );
};

export default DashboardPage;
