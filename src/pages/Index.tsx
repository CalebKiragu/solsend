import React from "react";
import HeroSection from "@/components/HeroSection";
import CreateLink from "@/components/CreateLink";

const Index: React.FC = () => {
  return (
    <div className="container py-8 max-w-4xl">
      <HeroSection />
      <CreateLink />
    </div>
  );
};

export default Index;
