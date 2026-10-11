import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "@fontsource/noto-sans-kr/400.css"
import "@fontsource/noto-sans-kr/500.css"
import "@fontsource/noto-sans-kr/600.css"
import "@fontsource/noto-sans-kr/700.css"
import "@fontsource/nanum-myeongjo/400.css"
import "@fontsource/nanum-myeongjo/700.css"
import "./styles/tokens.css"
import "./styles/layout.css"
import "./styles/components.css"
import "./styles/versions.css"
import "./styles/revision.css"
import "./styles/evaluation.css"
import "./styles/responsive.css"

const root = document.getElementById("root")
if (!root) throw new Error("NOVAIL root element is missing")
createRoot(root).render(<StrictMode><App /></StrictMode>)
