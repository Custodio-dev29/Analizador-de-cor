document.addEventListener('DOMContentLoaded', () => {
    // --- ESTADO DA APLICAÇÃO ---
    let currentColor = null;
    let selectedStandard = null;
    let standards = [];
    let captures = [];
    let isDragging = false;
    let debounceTimer;
    let currentIlluminant = 'D65';
    let currentSampleSize = 5;

    // --- CONSTANTES ---
    const MAX_FILE_SIZE_MB = 10;
    const DEBOUNCE_DELAY_MS = 50;
    const ILLUMINANTS = {
        'D65': { x: 95.047, y: 100.000, z: 108.883 }, // Luz do Dia (padrão)
        'A':   { x: 109.850, y: 100.000, z: 35.585 },  // Tungstênio / Incandescente
        'F2':  { x: 99.187, y: 100.000, z: 67.395 }   // Fluorescente Branca Fria
    };

    // --- SELETORES DE DOM ---
    const illuminantSelect = document.getElementById('illuminantSelect');
    const sampleSizeSelect = document.getElementById('sampleSizeSelect');
    const imageInput = document.getElementById('imageInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const imageContainer = document.getElementById('imageContainer');
    const uploadedImage = document.getElementById('uploadedImage');
    const colorPicker = document.getElementById('colorPicker');
    const coordinatesEl = document.getElementById('coordinates');
    const colorInfo = document.getElementById('colorInfo');
    const colorPreview = document.getElementById('colorPreview');
    const rgbValueEl = document.getElementById('rgbValue');
    const hexValueEl = document.getElementById('hexValue');
    const labLEl = document.getElementById('labL');
    const labAEl = document.getElementById('labA');
    const labBEl = document.getElementById('labB');
    const deltaEEl = document.getElementById('deltaE');
    const saveStandardBtn = document.getElementById('saveStandardBtn');
    const deleteStandardBtn = document.getElementById('deleteStandardBtn');
    const captureColorBtn = document.getElementById('captureColorBtn');
    const standardsGrid = document.getElementById('standardsGrid');
    const magnifier = document.getElementById('magnifier');
    const magnifierCanvas = document.getElementById('magnifierCanvas');
    const resultsTableBody = document.getElementById('resultsTableBody');

    // --- CANVAS GLOBAL ---
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // --- UTILIDADES DE COR ---
    function rgbToXyz(r,g,b){
        r = r/255; g = g/255; b = b/255;
        r = r > 0.04045 ? Math.pow((r+0.055)/1.055, 2.4) : r/12.92;
        g = g > 0.04045 ? Math.pow((g+0.055)/1.055, 2.4) : g/12.92;
        b = b > 0.04045 ? Math.pow((b+0.055)/1.055, 2.4) : b/12.92;
        r *= 100; g *= 100; b *= 100;
        const x = r*0.4124 + g*0.3576 + b*0.1805;
        const y = r*0.2126 + g*0.7152 + b*0.0722;
        const z = r*0.0193 + g*0.1192 + b*0.9505;
        return [x,y,z];
    }

    function xyzToLab(x, y, z, illuminantRef) {
        const { x: xn, y: yn, z: zn } = illuminantRef;
        x = x / xn; y = y / yn; z = z / zn;
        x = x > 0.008856 ? Math.cbrt(x) : (7.787 * x + 16/116);
        y = y > 0.008856 ? Math.cbrt(y) : (7.787 * y + 16/116);
        z = z > 0.008856 ? Math.cbrt(z) : (7.787 * z + 16/116);
        const L = (116 * y) - 16;
        const a = 500 * (x - y);
        const b = 200 * (y - z);
        return [L, a, b];
    }

    function rgbToLab(r,g,b){
        const illuminantRef = ILLUMINANTS[currentIlluminant];
        return xyzToLab(...rgbToXyz(r, g, b), illuminantRef);
    }

    function rgbToHex(r,g,b){
        return '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1).toUpperCase();
    }

    // ΔE76 (simples)
    function deltaE76(lab1, lab2){
        const dL = lab1[0]-lab2[0];
        const da = lab1[1]-lab2[1];
        const db = lab1[2]-lab2[2];
        return Math.sqrt(dL*dL + da*da + db*db);
    }

    // ΔE2000 (implementação padrão)
    function deg2rad(d){ return d * (Math.PI/180); }
    function rad2deg(r){ return r * (180/Math.PI); }

    function deltaE2000(lab1, lab2){
        // baseado na fórmula oficial (Sharma et al.)
        const L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
        const L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];

        const C1 = Math.sqrt(a1*a1 + b1*b1);
        const C2 = Math.sqrt(a2*a2 + b2*b2);
        const avgC = (C1 + C2) / 2.0;

        const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC,7) / (Math.pow(avgC,7) + Math.pow(25,7))));
        const a1p = (1 + G) * a1;
        const a2p = (1 + G) * a2;

        const C1p = Math.sqrt(a1p*a1p + b1*b1);
        const C2p = Math.sqrt(a2p*a2p + b2*b2);

        let h1p = Math.atan2(b1, a1p);
        let h2p = Math.atan2(b2, a2p);
        h1p = h1p >= 0 ? rad2deg(h1p) : rad2deg(h1p) + 360;
        h2p = h2p >= 0 ? rad2deg(h2p) : rad2deg(h2p) + 360;

        const dLp = L2 - L1;
        const dCp = C2p - C1p;

        let dhp = 0;
        if (C1p * C2p === 0) {
            dhp = 0;
        } else {
            dhp = h2p - h1p;
            if (dhp > 180) dhp -= 360;
            if (dhp < -180) dhp += 360;
        }
        const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp / 2));

        const avgLp = (L1 + L2) / 2.0;
        const avgCp = (C1p + C2p) / 2.0;

        let avghp = 0;
        if (C1p * C2p === 0) {
            avghp = h1p + h2p;
        } else {
            if (Math.abs(h1p - h2p) > 180) {
                avghp = (h1p + h2p + 360) / 2.0;
            } else {
                avghp = (h1p + h2p) / 2.0;
            }
        }

        const T = 1 - 0.17 * Math.cos(deg2rad(avghp - 30)) + 0.24 * Math.cos(deg2rad(2 * avghp)) + 0.32 * Math.cos(deg2rad(3 * avghp + 6)) - 0.20 * Math.cos(deg2rad(4 * avghp - 63));
        const SL = 1 + ((0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2)));
        const SC = 1 + 0.045 * avgCp;
        const SH = 1 + 0.015 * avgCp * T;
        const deltaTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2));
        const RC = 2 * Math.sqrt(Math.pow(avgCp,7) / (Math.pow(avgCp,7) + Math.pow(25,7)));
        const RT = -Math.sin(deg2rad(2 * deltaTheta)) * RC;

        const dL_SL = dLp / SL;
        const dC_SC = dCp / SC;
        const dH_SH = dHp / SH;

        const result = Math.sqrt(dL_SL * dL_SL + dC_SC * dC_SC + dH_SH * dH_SH + RT * dC_SC * dH_SH);
        return result;
    }

    // --- LÓGICA DE UPLOAD E MANIPULAÇÃO DA IMAGEM ---
    uploadBtn.addEventListener('click', () => imageInput.click());

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        // Validação de tipo e tamanho do arquivo
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            alert(`O arquivo é muito grande. O tamanho máximo é de ${MAX_FILE_SIZE_MB}MB.`);
            e.target.value = ''; // Limpa o input
            return;
        }

        if (!file.type || !file.type.startsWith('image/')) {
            alert('Por favor, selecione um arquivo de imagem válido.');
            return;
        }
        const reader = new FileReader();
        reader.onload = function(ev){
            uploadedImage.src = ev.target.result;
            imageContainer.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    });

    uploadedImage.addEventListener('load', () => {
        // preparar canvas com resolução real da imagem
        canvas.width = uploadedImage.naturalWidth;
        canvas.height = uploadedImage.naturalHeight;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(uploadedImage, 0, 0, canvas.width, canvas.height);

        // mostrar container e picker
        imageContainer.classList.remove('hidden');
        colorPicker.classList.remove('hidden');

        // posicionar o picker no centro da imagem exibida (usando bounding rect)
        const rect = uploadedImage.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        setPickerPosition(centerX, centerY);
        extractColorAtDisplayedPoint(centerX, centerY);
    });

    function setPickerPosition(displayX, displayY){
        // displayX/Y são coordenadas relativas ao canto superior esquerdo da imagem (em px, conforme getBoundingClientRect)
        colorPicker.style.left = displayX + 'px';
        colorPicker.style.top = displayY + 'px';
    
    }

    function extractAverageColorAtDisplayedPoint(displayX, displayY, sampleSize){
        // converter para coordenadas do canvas (resolução natural)
        const rect = uploadedImage.getBoundingClientRect();
        const scaleX = uploadedImage.naturalWidth / rect.width;
        const scaleY = uploadedImage.naturalHeight / rect.height;
        const centerX = Math.floor(displayX * scaleX);
        const centerY = Math.floor(displayY * scaleY);

        // Define a área de amostragem (ex: 5x5 pixels)
        const halfSize = Math.floor(sampleSize / 2);
        const startX = Math.max(0, centerX - halfSize);
        const startY = Math.max(0, centerY - halfSize);
        const endX = Math.min(canvas.width, centerX + halfSize + 1);
        const endY = Math.min(canvas.height, centerY + halfSize + 1);
        const sampleWidth = endX - startX;
        const sampleHeight = endY - startY;

        try {
            if (sampleWidth <= 0 || sampleHeight <= 0) return; // Evita erro se a área for inválida

            const imageData = ctx.getImageData(startX, startY, sampleWidth, sampleHeight);
            const data = imageData.data;
            let totalR = 0, totalG = 0, totalB = 0;

            for (let i = 0; i < data.length; i += 4) {
                totalR += data[i];
                totalG += data[i+1];
                totalB += data[i+2];
            }
            const pixelCount = data.length / 4;
            currentColor = { r: Math.round(totalR / pixelCount), g: Math.round(totalG / pixelCount), b: Math.round(totalB / pixelCount) };
            updateColorDisplay();
        } catch (err) {
            console.error('Erro ao ler pixel:', err);
        }
    }

    function updateMagnifier(displayX, displayY, sampleSize) {
        const magnifierCtx = magnifierCanvas.getContext('2d');
        const zoomFactor = 10; // Nível de zoom
        const sourceSize = magnifierCanvas.width / zoomFactor; // Quantos pixels da imagem original vamos mostrar

        // Posiciona a lupa um pouco acima e à direita do seletor
        const magnifierX = displayX + 60;
        const magnifierY = displayY - 60;
        magnifier.style.left = `${magnifierX}px`;
        magnifier.style.top = `${magnifierY}px`;

        // Converte a posição do seletor para coordenadas da imagem original
        const rect = uploadedImage.getBoundingClientRect();
        const scaleX = uploadedImage.naturalWidth / rect.width;
        const scaleY = uploadedImage.naturalHeight / rect.height;
        const sourceX = (displayX * scaleX) - (sourceSize / 2);
        const sourceY = (displayY * scaleY) - (sourceSize / 2);

        // Limpa e desenha a porção da imagem original no canvas da lupa (com zoom)
        magnifierCtx.fillStyle = 'black';
        magnifierCtx.fillRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
        magnifierCtx.imageSmoothingEnabled = false; // Essencial para o visual pixelado
        magnifierCtx.drawImage(
            canvas, // O canvas da imagem original
            sourceX, sourceY, sourceSize, sourceSize, // De onde copiar (source)
            0, 0, magnifierCanvas.width, magnifierCanvas.height // Onde desenhar (destination)
        );

        // Desenha um quadrado no centro da lupa para indicar a área de amostragem (5x5)
        const centerBoxSize = sampleSize * zoomFactor;
        magnifierCtx.strokeStyle = 'red';
        magnifierCtx.lineWidth = 2;
        magnifierCtx.strokeRect((magnifierCanvas.width - centerBoxSize) / 2, (magnifierCanvas.height - centerBoxSize) / 2, centerBoxSize, centerBoxSize);
    }

    // mover picker — recebe clientX/clientY da janela
    function handleMove(clientX, clientY){
        const imgRect = uploadedImage.getBoundingClientRect();
        let relX = clientX - imgRect.left;
        let relY = clientY - imgRect.top;
        // clamp dentro da imagem exibida
        relX = Math.max(0, Math.min(relX, imgRect.width));
        relY = Math.max(0, Math.min(relY, imgRect.height));
        setPickerPosition(relX, relY);
        coordinatesEl.classList.remove('hidden');
        coordinatesEl.textContent = `x: ${Math.round(relX)}, y: ${Math.round(relY)}`;

        // Debounce para evitar sobrecarga de processamento
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updateMagnifier(relX, relY, currentSampleSize);
            extractAverageColorAtDisplayedPoint(relX, relY, currentSampleSize);
        }, DEBOUNCE_DELAY_MS);
    }

    // --- EVENTOS DE INTERAÇÃO (MOUSE/TOQUE) ---
    colorPicker.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDragging = true;
        coordinatesEl.classList.remove('hidden');
        magnifier.classList.remove('hidden');
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const t = e.touches[0];
        handleMove((t.clientX), t.clientY);
        
    }, { passive: false });

    document.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        setTimeout(()=> coordinatesEl.classList.add('hidden'), 1500);
        magnifier.classList.add('hidden');
    });

    colorPicker.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        coordinatesEl.classList.remove('hidden');
        magnifier.classList.remove('hidden');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        handleMove(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        setTimeout(()=> coordinatesEl.classList.add('hidden'), 1500);
        magnifier.classList.add('hidden');
    });

    // --- ATUALIZAÇÃO DA INTERFACE ---
    function updateColorDisplay(){
        if (!currentColor) return;
        const { r, g, b } = currentColor;
        const [L, a, bLab] = rgbToLab(r, g, b);
        const hex = rgbToHex(r, g, b);
        colorPreview.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        rgbValueEl.textContent = `${r}, ${g}, ${b}`;
        hexValueEl.textContent = hex;
        labLEl.textContent = L.toFixed(1);
        labAEl.textContent = a.toFixed(1);
        labBEl.textContent = bLab.toFixed(1);

        if (selectedStandard) {
            const standardLab = rgbToLab(selectedStandard.r, selectedStandard.g, selectedStandard.b);
            const de = deltaE2000([L,a,bLab], standardLab);
            deltaEEl.textContent = de.toFixed(2);
        } else {
            deltaEEl.textContent = '-';
        }

        colorInfo.classList.remove('hidden');
    }

    // --- LÓGICA DE PADRÕES E CAPTURAS ---
    function saveAsStandard(){
        if (!currentColor) return alert('Nenhuma cor selecionada.');
        const s = {
            id: Date.now(),
            r: currentColor.r,
            g: currentColor.g,
            b: currentColor.b,
            timestamp: new Date().toLocaleString()
        };
        standards.push(s);
        saveData();
        updateStandardsDisplay();
    }

    function updateStandardsDisplay(){
        standardsGrid.innerHTML = '';
        standards.forEach((std, idx) => {
            const item = document.createElement('div');
            item.className = 'standard-item';
            item.style.backgroundColor = `rgb(${std.r}, ${std.g}, ${std.b})`;
            item.textContent = (idx + 1);
            item.dataset.id = std.id;

            if (selectedStandard && selectedStandard.id === std.id) {
                item.classList.add('selected');
            }

            item.addEventListener('click', () => {
                // alterna seleção
                if (selectedStandard && selectedStandard.id === std.id) {
                    selectedStandard = null;
                } else {
                    selectedStandard = std;
                }
                updateStandardsDisplay(); // redesenha para refletir seleção
                updateColorDisplay();
            });
            standardsGrid.appendChild(item);
        });
        // Mostra ou esconde o botão de deletar com base na seleção
        deleteStandardBtn.classList.toggle('hidden', !selectedStandard);
    }

    function captureColor(){
        if (!currentColor) return alert('Nenhuma cor selecionada.');
        
        // Captura os valores RGB fixos. L*a*b* e Delta E serão calculados dinamicamente.
        const { r, g, b } = currentColor;
        const hex = rgbToHex(r,g,b);
        
        // O standardUsed também armazena apenas RGB.
        let standardUsedRgb = null;
        if (selectedStandard) {
            standardUsedRgb = { r: selectedStandard.r, g: selectedStandard.g, b: selectedStandard.b };
        }

        // O Delta E é calculado no momento da captura com o iluminante atual.
        // Ele também será recalculado na exibição da tabela se o iluminante mudar.
        const [L, a, bLab] = rgbToLab(r, g, b);
        let deltaEvalue = '-';
        if (standardUsedRgb) {
            deltaEvalue = deltaE2000([L, a, bLab], rgbToLab(standardUsedRgb.r, standardUsedRgb.g, standardUsedRgb.b)).toFixed(2);
        }
        const cap = {
            id: Date.now(),
            r,g,b,
            l: L.toFixed(1),
            a: a.toFixed(1),
            b_lab: bLab.toFixed(1),
            hex,
            deltaE: deltaEvalue,
            standardUsedRgb, // Armazena o RGB do padrão, não o objeto completo
            timestamp: new Date().toLocaleString()
        };
        captures.push(cap);
        saveData();
        updateResultsTable();
    }

    function updateResultsTable(){
        resultsTableBody.innerHTML = '';
        captures.toReversed().forEach(c => { // .toReversed() para mostrar os mais recentes primeiro
            const tr = document.createElement('tr');
            tr.dataset.captureId = c.id;

            // Recalcula L*a*b* e Delta E para a exibição com o iluminante atual
            const [l, a, b_lab] = rgbToLab(c.r, c.g, c.b);
            let deltaE = '-';
            let standardHtml = '<td>-</td>';

            if (c.standardUsedRgb) {
                const standardLab = rgbToLab(c.standardUsedRgb.r, c.standardUsedRgb.g, c.standardUsedRgb.b);
                deltaE = deltaE2000([l, a, b_lab], standardLab).toFixed(2);
                standardHtml = `<td><div class="color-cell" style="background-color: rgb(${c.standardUsedRgb.r}, ${c.standardUsedRgb.g}, ${c.standardUsedRgb.b})"></div></td>`;
            }

            tr.innerHTML = `
                <td><div class="color-cell" style="background-color: rgb(${c.r}, ${c.g}, ${c.b})"></div></td>
                ${standardHtml}
                <td>${l.toFixed(1)}</td>
                <td>${a.toFixed(1)}</td>
                <td>${b_lab.toFixed(1)}</td>
                <td>${c.r}, ${c.g}, ${c.b}</td>
                <td>${c.hex}</td>
                <td>${deltaE}</td>
                <td><button class="delete-btn" aria-label="Excluir captura">🗑️</button></td>
            `;
            resultsTableBody.appendChild(tr);
        });
    }

    function deleteCapture(id){
        captures = captures.filter(c => c.id !== id);
        saveData();
        updateResultsTable();
    }

    // --- PERSISTÊNCIA (LOCALSTORAGE) ---
    function saveData(){
        localStorage.setItem('colorStandards', JSON.stringify(standards));
        localStorage.setItem('colorCaptures', JSON.stringify(captures));
        localStorage.setItem('colorAnalyzerSettings', JSON.stringify({ illuminant: currentIlluminant, sampleSize: currentSampleSize }));
    }

    function loadData(){
        const s = localStorage.getItem('colorStandards');
        if (s) standards = JSON.parse(s);
        const c = localStorage.getItem('colorCaptures');
        if (c) captures = JSON.parse(c);
        const savedSettings = localStorage.getItem('colorAnalyzerSettings');
        if (savedSettings) {
            const { illuminant, sampleSize } = JSON.parse(savedSettings);
            if (illuminant && ILLUMINANTS[illuminant]) {
                currentIlluminant = illuminant;
                illuminantSelect.value = illuminant;
            }
            currentSampleSize = sampleSize || 5;
            sampleSizeSelect.value = currentSampleSize;
        }

        updateStandardsDisplay();
        updateResultsTable();
    }

    // --- LIGAÇÕES DE EVENTOS E INICIALIZAÇÃO ---
    saveStandardBtn.addEventListener('click', saveAsStandard);
    captureColorBtn.addEventListener('click', captureColor);

    deleteStandardBtn.addEventListener('click', () => {
        if (!selectedStandard) return;
        const idx = standards.findIndex(s => s.id === selectedStandard.id);
        if (idx > -1) {
            standards.splice(idx, 1);
            selectedStandard = null;
            saveData();
            updateStandardsDisplay();
            updateColorDisplay();
        }
    });

    resultsTableBody.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('delete-btn')) {
            const row = e.target.closest('tr');
            if (row && row.dataset.captureId) {
                const idToDelete = parseInt(row.dataset.captureId, 10);
                deleteCapture(idToDelete);
            }
        }
    });

    illuminantSelect.addEventListener('change', (e) => {
        currentIlluminant = e.target.value;
        localStorage.setItem('colorAnalyzerIlluminant', currentIlluminant);
        updateColorDisplay(); // Recalcula a cor principal
        updateResultsTable(); // Recalcula toda a tabela
    });

    sampleSizeSelect.addEventListener('change', (e) => {
        currentSampleSize = parseInt(e.target.value, 10);
        saveData();
        // Recalcula a cor e a lupa com o novo tamanho de amostra
        const pickerRect = colorPicker.getBoundingClientRect();
        const imgRect = uploadedImage.getBoundingClientRect();
        handleMove(pickerRect.left + (pickerRect.width / 2), pickerRect.top + (pickerRect.height / 2));
    });

    // carregar dados ao iniciar
    loadData();

    function getPixelColor(x, y) {
        const img = document.getElementById('uploadedImage');
        const canvas = document.createElement('canvas');
        // Modificar esta linha para incluir willReadFrequently
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // Configurar canvas com dimensões da imagem original
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        // Desenhar imagem no canvas
        ctx.drawImage(img, 0, 0);
        
        // Obter dados do pixel
        try {
            const imageData = ctx.getImageData(x, y, 1, 1);
            const [r, g, b] = imageData.data;
            return { r, g, b };
        } catch (error) {
            console.error('Erro ao obter cor:', error);
            return null;
        }
    }

    function extractColorAtDisplayedPoint(displayX, displayY) {
        const img = document.getElementById('uploadedImage');
        const rect = img.getBoundingClientRect();
        
        // Converter coordenadas de exibição para coordenadas da imagem
        const x = Math.round((displayX - rect.left) * (img.naturalWidth / rect.width));
        const y = Math.round((displayY - rect.top) * (img.naturalHeight / rect.height));
        
        // Criar canvas temporário
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        // Desenhar imagem e obter dados do pixel
        try {
            ctx.drawImage(img, 0, 0);
            const sampleSize = parseInt(document.getElementById('sampleSizeSelect').value);
            const halfSample = Math.floor(sampleSize / 2);
            
            // Calcular média da área selecionada
            let r = 0, g = 0, b = 0;
            let count = 0;
            
            for (let offsetY = -halfSample; offsetY <= halfSample; offsetY++) {
                for (let offsetX = -halfSample; offsetX <= halfSample; offsetX++) {
                    const sampleX = x + offsetX;
                    const sampleY = y + offsetY;
                    
                    if (sampleX >= 0 && sampleX < img.naturalWidth && 
                        sampleY >= 0 && sampleY < img.naturalHeight) {
                        const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                        r += pixel[0];
                        g += pixel[1];
                        b += pixel[2];
                        count++;
                    }
                }
            }
            
            // Calcular média
            return {
                r: Math.round(r / count),
                g: Math.round(g / count),
                b: Math.round(b / count),
                x: x,
                y: y
            };
        } catch (error) {
            console.error('Erro ao extrair cor:', error);
            return null;
        }
    }
});