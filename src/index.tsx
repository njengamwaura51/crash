import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import './index.scss';
import GameApp from './components/GameApp';
import { MockProvider } from './mockContext';

createRoot(document.getElementById("root") as HTMLElement).render(
	<BrowserRouter>
		<Routes>
			<Route path="*" element={
				<MockProvider>
					<GameApp />
					<ToastContainer position="top-center" theme="dark" />
				</MockProvider>
			} />
		</Routes>
	</BrowserRouter>
);
