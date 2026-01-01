
import { GoogleGenAI, Type } from "@google/genai";

export const categorizeChats = async (titles: string[]) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Categorize the following chat history titles into logical folders: ${titles.join(', ')}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              categoryName: { type: Type.STRING },
              titles: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["categoryName", "titles"]
          }
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Categorization Error:", error);
    return null;
  }
};
