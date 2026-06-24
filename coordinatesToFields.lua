-- Author:      PixelFarm
-- Name:        coordinatesToFields
-- Namespace:   local
-- Description: Import field coordinates from XML into Giants Editor with a visual UI
-- Icon:
-- Hide:        no
-- AlwaysLoaded: yes

-- ─────────────────────────────────────────────────────────────────────────────
--  Dependencies
-- ─────────────────────────────────────────────────────────────────────────────
source("map/farmlandFields/fieldUtil.lua")
source("map/farmlandFields/fieldToolkit.lua")

-- ─────────────────────────────────────────────────────────────────────────────
--  Colour palette  (all values are 0-1 floats: r, g, b, a)
-- ─────────────────────────────────────────────────────────────────────────────
local C = {
    -- backgrounds
    panel       = { 0.07, 0.07, 0.07, 0.97 },
    titleBar    = { 0.04, 0.04, 0.04, 1.00 },
    sectionBg   = { 0.10, 0.10, 0.10, 1.00 },
    inputBg     = { 0.11, 0.11, 0.11, 1.00 },
    inputFocus  = { 0.13, 0.18, 0.07, 1.00 },
    logBg       = { 0.06, 0.06, 0.06, 1.00 },
    border      = { 0.20, 0.20, 0.20, 1.00 },
    borderGreen = { 0.49, 0.73, 0.20, 1.00 },
    -- buttons
    btnImport   = { 0.30, 0.46, 0.12, 1.00 },
    btnImportHv = { 0.38, 0.57, 0.16, 1.00 },
    btnClose    = { 0.18, 0.18, 0.18, 1.00 },
    btnCloseHv  = { 0.26, 0.26, 0.26, 1.00 },
    btnBrowse   = { 0.16, 0.22, 0.08, 1.00 },
    btnBrowseHv = { 0.22, 0.30, 0.12, 1.00 },
    -- text
    textMain    = { 0.82, 0.82, 0.82, 1.00 },
    textDim     = { 0.44, 0.44, 0.44, 1.00 },
    textGreen   = { 0.62, 0.83, 0.39, 1.00 },
    textTitle   = { 0.92, 0.92, 0.92, 1.00 },
    textError   = { 0.90, 0.35, 0.35, 1.00 },
    textSuccess = { 0.55, 0.85, 0.30, 1.00 },
    textPath    = { 0.78, 0.78, 0.78, 1.00 },
    -- misc
    cursor      = { 0.62, 0.83, 0.39, 1.00 },
    checkOn     = { 0.49, 0.73, 0.20, 1.00 },
    checkOff    = { 0.25, 0.25, 0.25, 1.00 },
    white       = { 1.00, 1.00, 1.00, 1.00 },
    scrim       = { 0.00, 0.00, 0.00, 0.55 },
}

-- ─────────────────────────────────────────────────────────────────────────────
--  Layout constants  (normalised 0-1 screen coords; built for 16:9)
-- ─────────────────────────────────────────────────────────────────────────────
local PW  = 0.44   -- panel width
local PH  = 0.48   -- panel height
local PX  = 0.28   -- panel left edge  (≈ centre)
local PY  = 0.26   -- panel bottom edge

local TS  = 0.018  -- normal text size
local TSS = 0.014  -- small text size
local TST = 0.020  -- title text size

-- ─────────────────────────────────────────────────────────────────────────────
--  Overlay handles  (created once in init)
-- ─────────────────────────────────────────────────────────────────────────────
local BLANK_IMG = "dataS/gui/elements/fillLayer.png"
local overlays  = {}

local function newOverlay()
    return createImageOverlay(BLANK_IMG)
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Helpers
-- ─────────────────────────────────────────────────────────────────────────────
local function setColor(c)
    setOverlayColor(overlays.box, c[1], c[2], c[3], c[4])
end

local function drawRect(x, y, w, h, c)
    setOverlayColor(overlays.box, c[1], c[2], c[3], c[4])
    renderOverlay(overlays.box, x, y, w, h)
end

local function drawBorder(x, y, w, h, t, c)
    -- top
    drawRect(x,         y + h - t, w,   t,   c)
    -- bottom
    drawRect(x,         y,         w,   t,   c)
    -- left
    drawRect(x,         y,         t,   h,   c)
    -- right
    drawRect(x + w - t, y,         t,   h,   c)
end

local function drawText(x, y, size, text, col, align, bold)
    setTextColor(col[1], col[2], col[3], col[4])
    setTextBold(bold or false)
    if align == "center" then
        setTextAlignment(RenderText.ALIGN_CENTER)
    elseif align == "right" then
        setTextAlignment(RenderText.ALIGN_RIGHT)
    else
        setTextAlignment(RenderText.ALIGN_LEFT)
    end
    renderText(x, y, size, text)
    setTextBold(false)
    setTextAlignment(RenderText.ALIGN_LEFT)
end

local function inRect(mx, my, x, y, w, h)
    return mx >= x and mx <= x + w and my >= y and my <= y + h
end

-- Truncate a string to fit within a pixel width, appending "…"
local function truncatePath(path, size, maxW)
    if getTextWidth(size, path) <= maxW then return path end
    -- try from right
    local prefix = "…"
    for i = 1, #path do
        local sub = prefix .. string.sub(path, i)
        if getTextWidth(size, sub) <= maxW then return sub end
    end
    return prefix
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Dialog state
-- ─────────────────────────────────────────────────────────────────────────────
local ui = {
    visible       = true,
    xmlPath       = "",        -- chosen file path
    pathFocused   = false,     -- keyboard focus on path input
    cursorBlink   = 0,
    cursorVisible = true,

    -- post-processing toggles
    opt = {
        clearGround    = true,
        alignTerrain   = true,
        adjustPivots   = true,
        repaintFields  = true,
    },

    -- status  (idle | running | done | error)
    status    = "idle",
    log       = {},            -- list of strings shown in the log panel
    maxLog    = 6,             -- how many lines to keep visible

    -- mouse hover tracking
    hov = {},
}

-- ─────────────────────────────────────────────────────────────────────────────
--  Logging  (appends to ui.log, keeps last N)
-- ─────────────────────────────────────────────────────────────────────────────
local function uiLog(msg)
    table.insert(ui.log, msg)
    if #ui.log > 40 then table.remove(ui.log, 1) end
    print("[FieldImporter] " .. msg)
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Core import logic  (same as original, with uiLog instead of print)
-- ─────────────────────────────────────────────────────────────────────────────
local function createFieldFromXML(fieldID, x, y, coordinates)
    local fieldNode = FieldUtil.getFieldsRootNode()
    if fieldNode == nil then
        uiLog("ERROR: No fields root node found")
        return nil
    end

    local name  = string.format("field%d", fieldID)
    local field = createTransformGroup(name)

    -- polygon points
    local polygonPoints = createTransformGroup("polygonPoints")
    for i, coord in ipairs(coordinates) do
        local point = createTransformGroup(string.format("point%d", i))
        setTranslation(point, coord.x, 0, coord.y)
        link(polygonPoints, point)
    end

    -- indicators
    local nameIndicator     = createTransformGroup("nameIndicator")
    local teleportIndicator = createTransformGroup("teleportIndicator")
    local note = createNoteNode(nameIndicator, name, 0, 0, 0, true)
    link(nameIndicator, note)
    setTranslation(note, 0, 0, 0)

    link(field, polygonPoints)
    link(field, nameIndicator)
    link(field, teleportIndicator)
    link(fieldNode, field)

    setUserAttribute(field, "polygonIndex",         UserAttributeType.STRING,  EditorUtils.getNodeIndexPath(field, polygonPoints))
    setUserAttribute(field, "nameIndicatorIndex",   UserAttributeType.STRING,  EditorUtils.getNodeIndexPath(field, nameIndicator))
    setUserAttribute(field, "teleportIndicatorIndex", UserAttributeType.STRING, EditorUtils.getNodeIndexPath(field, teleportIndicator))
    setUserAttribute(field, "angle",                UserAttributeType.INTEGER, 0)
    setUserAttribute(field, "missionOnlyGrass",     UserAttributeType.BOOLEAN, false)
    setUserAttribute(field, "missionAllowed",       UserAttributeType.BOOLEAN, true)

    setTranslation(field, x, 0, y)
    FieldToolkit.updateFieldNote(field)
    addSelection(field)

    uiLog(string.format("Created field%d  (X:%d  Y:%d)", fieldID, x, y))
    return field
end

local function runImport()
    if ui.xmlPath == "" then
        uiLog("No XML file selected. Use the Browse button or type a path.")
        ui.status = "error"
        return
    end

    ui.status = "running"
    ui.log    = {}
    uiLog("Loading: " .. ui.xmlPath)

    local xmlFile = loadXMLFile("FieldData", ui.xmlPath)
    if xmlFile == 0 or xmlFile == nil then
        uiLog("ERROR: Could not open XML file")
        ui.status = "error"
        return
    end

    local count = 0
    local i = 0
    while true do
        local fieldKey = string.format("Fields.Field(%d)", i)
        if not hasXMLProperty(xmlFile, fieldKey) then break end

        local fieldID = getXMLInt(xmlFile, fieldKey .. "#ID")
        local fieldX  = getXMLInt(xmlFile, fieldKey .. "#X")
        local fieldY  = getXMLInt(xmlFile, fieldKey .. "#Y")

        local coordinates = {}
        local j = 0
        while true do
            local coordKey = string.format("%s.coordinate(%d)", fieldKey, j)
            if not hasXMLProperty(xmlFile, coordKey) then break end
            table.insert(coordinates, {
                x = getXMLFloat(xmlFile, coordKey .. "#X"),
                y = getXMLFloat(xmlFile, coordKey .. "#Y"),
            })
            j = j + 1
        end

        createFieldFromXML(fieldID, fieldX, fieldY, coordinates)
        count = count + 1
        i     = i + 1
    end

    delete(xmlFile)
    uiLog(string.format("Imported %d field%s.", count, count ~= 1 and "s" or ""))

    -- ── post-processing ─────────────────────────────────────────────────────
    if ui.opt.clearGround then
        uiLog("Running: clearFieldGround …")
        FieldToolkit:clearFieldGround()
    end
    if ui.opt.alignTerrain then
        uiLog("Running: alignPolygonPointsToTerrain …")
        FieldToolkit:alignPolygonPointsToTerrain()
    end
    if ui.opt.adjustPivots then
        uiLog("Running: adjustFieldPivots …")
        FieldToolkit:adjustFieldPivots()
    end
    if ui.opt.repaintFields then
        uiLog("Running: repaintFields …")
        FieldToolkit:repaintFields()
    end

    uiLog("Done ✓")
    ui.status = "done"
end

-- ─────────────────────────────────────────────────────────────────────────────
--  File browser  (try native GE dialog; fall back to activating path input)
-- ─────────────────────────────────────────────────────────────────────────────
local function openFileBrowser()
    -- Giants Editor exposes g_editor:showOpenFileDialog on some builds.
    -- We pcall it so we degrade gracefully if unavailable.
    local ok, err = pcall(function()
        g_editor:showOpenFileDialog(
            "Select XML file",
            "*.xml",
            ui.xmlPath ~= "" and ui.xmlPath or "",
            function(path)
                if path and path ~= "" then
                    ui.xmlPath    = path
                    ui.pathFocused = false
                    uiLog("Selected: " .. path)
                end
            end
        )
    end)
    if not ok then
        -- Fall back: activate the text field so user can type the path
        ui.pathFocused = true
        uiLog("Native file dialog unavailable — type the path and press Enter")
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Drawing
-- ─────────────────────────────────────────────────────────────────────────────

-- Named rects updated each frame so mouse hit-tests use current positions
local rects = {}

local function drawCheckbox(x, y, size, label, value, key)
    local bx, by, bs = x, y - size * 0.1, size * 0.80
    rects["chk_" .. key] = { bx, by, bs, bs }

    -- box
    drawRect(bx, by, bs, bs, value and C.checkOn or C.checkOff)
    -- tick mark
    if value then
        drawText(bx + bs * 0.12, by + bs * 0.10, bs * 0.90, "✓", C.titleBar, "left", true)
    end
    -- label
    drawText(x + bs + 0.008, y, size, label, C.textMain, "left")
end

local function getVisibleLog()
    local lines = {}
    local start = math.max(1, #ui.log - ui.maxLog + 1)
    for i = start, #ui.log do
        table.insert(lines, ui.log[i])
    end
    return lines
end

function draw()
    if not ui.visible then return end

    -- ── scrim ────────────────────────────────────────────────────────────────
    drawRect(0, 0, 1, 1, C.scrim)

    -- ── panel shadow ─────────────────────────────────────────────────────────
    drawRect(PX + 0.004, PY - 0.004, PW, PH, { 0, 0, 0, 0.60 })

    -- ── main panel bg ────────────────────────────────────────────────────────
    drawRect(PX, PY, PW, PH, C.panel)
    drawBorder(PX, PY, PW, PH, 0.0015, C.border)

    local cx  = PX + PW * 0.5          -- horizontal centre
    local y   = PY + PH                -- current Y cursor (working top→bottom)
    local pad = 0.014                  -- horizontal inner padding
    local lx  = PX + pad               -- left content edge
    local rw  = PW - pad * 2           -- content width

    -- ── title bar ────────────────────────────────────────────────────────────
    local titleH = 0.042
    y = y - titleH
    drawRect(PX, y, PW, titleH, C.titleBar)
    drawBorder(PX, y, PW, titleH, 0.0015, C.border)

    -- green accent stripe on left
    drawRect(PX, y, 0.004, titleH, C.borderGreen)

    setTextBold(true)
    drawText(lx + 0.010, y + titleH * 0.28, TST, "FS25 Field Importer", C.textTitle, "left", true)
    setTextBold(false)

    -- version tag
    drawText(PX + PW - pad - 0.001, y + titleH * 0.28, TSS, "v1.0  —  PixelFarm", C.textDim, "right")

    -- ── spacer ───────────────────────────────────────────────────────────────
    y = y - 0.014

    -- ── XML FILE section ─────────────────────────────────────────────────────
    local secH  = 0.074
    local secY  = y - secH
    drawRect(PX + 0.002, secY, PW - 0.004, secH, C.sectionBg)

    -- label
    drawText(lx, secY + secH - 0.016, TSS, "XML FILE", C.textGreen, "left", true)

    -- browse button  (right side)
    local bBtnW = 0.072
    local bBtnH = 0.028
    local bBtnX = PX + PW - pad - bBtnW
    local bBtnY = secY + (secH - bBtnH) * 0.35
    rects["browse"] = { bBtnX, bBtnY, bBtnW, bBtnH }
    local bHov = ui.hov["browse"]
    drawRect(bBtnX, bBtnY, bBtnW, bBtnH, bHov and C.btnBrowseHv or C.btnBrowse)
    drawBorder(bBtnX, bBtnY, bBtnW, bBtnH, 0.0012, C.borderGreen)
    drawText(bBtnX + bBtnW * 0.5, bBtnY + bBtnH * 0.20, TSS, "Browse…", C.textGreen, "center", true)

    -- path input field
    local inpW = PW - pad * 2 - bBtnW - 0.010
    local inpH = 0.028
    local inpX = lx
    local inpY = bBtnY
    rects["pathInput"] = { inpX, inpY, inpW, inpH }

    local inpBg = ui.pathFocused and C.inputFocus or C.inputBg
    drawRect(inpX, inpY, inpW, inpH, inpBg)
    drawBorder(inpX, inpY, inpW, inpH, 0.0012,
        ui.pathFocused and C.borderGreen or C.border)

    -- display path (truncated if needed)
    local displayPath = ui.xmlPath ~= "" and ui.xmlPath or "Type path here or click Browse…"
    local pathColor   = ui.xmlPath ~= "" and C.textPath or C.textDim
    local maxPathW    = inpW - 0.010
    local truncated   = truncatePath(displayPath, TSS, maxPathW)
    drawText(inpX + 0.005, inpY + inpH * 0.20, TSS, truncated, pathColor, "left")

    -- blinking cursor
    if ui.pathFocused and ui.cursorVisible then
        local curW  = getTextWidth(TSS, ui.xmlPath)
        local curX  = inpX + 0.005 + math.min(curW, maxPathW)
        drawRect(curX, inpY + 0.003, 0.0012, inpH - 0.006, C.cursor)
    end

    y = secY - 0.012

    -- ── POST-PROCESSING section ───────────────────────────────────────────────
    local optH  = 0.095
    local optY  = y - optH
    drawRect(PX + 0.002, optY, PW - 0.004, optH, C.sectionBg)
    drawText(lx, optY + optH - 0.016, TSS, "POST-PROCESSING", C.textGreen, "left", true)

    local col1X = lx + 0.006
    local col2X = PX + PW * 0.52
    local rowY  = optY + optH - 0.038

    drawCheckbox(col1X, rowY,          TS, "Clear field ground",            ui.opt.clearGround,   "clearGround")
    drawCheckbox(col2X, rowY,          TS, "Align polygon points to terrain", ui.opt.alignTerrain, "alignTerrain")
    drawCheckbox(col1X, rowY - 0.030,  TS, "Adjust field pivots",           ui.opt.adjustPivots,  "adjustPivots")
    drawCheckbox(col2X, rowY - 0.030,  TS, "Repaint fields",                ui.opt.repaintFields, "repaintFields")

    y = optY - 0.010

    -- ── LOG section ──────────────────────────────────────────────────────────
    local logH = 0.082
    local logY = y - logH
    drawRect(PX + 0.002, logY, PW - 0.004, logH, C.logBg)
    drawBorder(PX + 0.002, logY, PW - 0.004, logH, 0.0012, C.border)
    drawText(lx, logY + logH - 0.014, TSS, "LOG", C.textDim, "left", true)

    local lines   = getVisibleLog()
    local lineH   = 0.013
    local lineTop = logY + logH - 0.026
    for li, line in ipairs(lines) do
        local lc = C.textMain
        if string.find(line, "ERROR") or string.find(line, "error") then
            lc = C.textError
        elseif string.find(line, "Done") or string.find(line, "Created") then
            lc = C.textSuccess
        elseif string.find(line, "Running:") then
            lc = C.textGreen
        end
        local ly = lineTop - (li - 1) * lineH
        if ly >= logY + 0.002 then
            drawText(lx + 0.002, ly, TSS * 0.88, line, lc, "left")
        end
    end

    if #ui.log == 0 then
        drawText(cx, logY + logH * 0.45, TSS, "No activity yet", C.textDim, "center")
    end

    y = logY - 0.014

    -- ── status bar ───────────────────────────────────────────────────────────
    local statusText = ({
        idle    = "Ready — select an XML file and click Import Fields",
        running = "Importing…",
        done    = "Import complete  ✓",
        error   = "Import failed — check the log above",
    })[ui.status] or ""
    local statusCol = ({
        idle    = C.textDim,
        running = C.textGreen,
        done    = C.textSuccess,
        error   = C.textError,
    })[ui.status] or C.textDim
    drawText(cx, y, TSS, statusText, statusCol, "center")

    y = y - 0.024

    -- ── buttons ──────────────────────────────────────────────────────────────
    local btnH  = 0.036
    local btnW  = (rw - 0.010) * 0.55
    local clsBW = (rw - 0.010) * 0.43

    -- Import Fields button
    local iBtnX = lx
    local iBtnY = y - btnH
    rects["import"] = { iBtnX, iBtnY, btnW, btnH }
    local iHov  = ui.hov["import"]
    local iDis  = (ui.status == "running")
    local iBg   = iDis and { 0.18, 0.28, 0.07, 0.50 } or (iHov and C.btnImportHv or C.btnImport)
    drawRect(iBtnX, iBtnY, btnW, btnH, iBg)
    drawBorder(iBtnX, iBtnY, btnW, btnH, 0.0015, iDis and C.textDim or C.borderGreen)
    local iLbl = ui.status == "running" and "Importing…" or "▶  Import Fields"
    drawText(iBtnX + btnW * 0.5, iBtnY + btnH * 0.25, TS, iLbl,
        iDis and C.textDim or C.textGreen, "center", true)

    -- Close button
    local cBtnX = iBtnX + btnW + 0.010
    local cBtnY = iBtnY
    rects["close"] = { cBtnX, cBtnY, clsBW, btnH }
    local cHov = ui.hov["close"]
    drawRect(cBtnX, cBtnY, clsBW, btnH, cHov and C.btnCloseHv or C.btnClose)
    drawBorder(cBtnX, cBtnY, clsBW, btnH, 0.0015, C.border)
    drawText(cBtnX + clsBW * 0.5, cBtnY + btnH * 0.25, TS, "✕  Close",
        C.textMain, "center")
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Update  (called every frame when AlwaysLoaded: yes)
-- ─────────────────────────────────────────────────────────────────────────────
function update(dt)
    if not ui.visible then return end

    -- cursor blink  (~1 Hz)
    ui.cursorBlink = ui.cursorBlink + dt
    if ui.cursorBlink > 0.5 then
        ui.cursorBlink   = 0
        ui.cursorVisible = not ui.cursorVisible
    end

    -- track mouse hover
    local mx, my = getMousePosition()
    for key, r in pairs(rects) do
        ui.hov[key] = inRect(mx, my, r[1], r[2], r[3], r[4])
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Mouse events
-- ─────────────────────────────────────────────────────────────────────────────
function mouseEvent(posX, posY, isDown, isUp, button)
    if not ui.visible then return end
    if button ~= Input.MOUSE_BUTTON_LEFT then return end
    if not isDown then return end

    -- path input field → focus it for keyboard input
    local pr = rects["pathInput"]
    if pr and inRect(posX, posY, pr[1], pr[2], pr[3], pr[4]) then
        ui.pathFocused = true
        return
    end

    -- click outside panel → unfocus text input
    if not inRect(posX, posY, PX, PY, PW, PH) then
        ui.pathFocused = false
        return
    end

    -- unfocus if clicking elsewhere inside panel
    ui.pathFocused = false

    -- Browse button
    if ui.hov["browse"] then
        openFileBrowser()
        return
    end

    -- Import button
    if ui.hov["import"] and ui.status ~= "running" then
        runImport()
        return
    end

    -- Close button
    if ui.hov["close"] then
        ui.visible = false
        uiLog("Dialog closed.")
        return
    end

    -- Checkboxes
    for _, key in ipairs({ "clearGround", "alignTerrain", "adjustPivots", "repaintFields" }) do
        if ui.hov["chk_" .. key] then
            ui.opt[key] = not ui.opt[key]
            return
        end
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Keyboard events  (only active when the path input field is focused)
-- ─────────────────────────────────────────────────────────────────────────────
function keyEvent(unicode, sym, modifier, isDown)
    if not ui.visible          then return end
    if not ui.pathFocused      then return end
    if not isDown              then return end

    -- Enter → confirm path
    if sym == Input.KEY_RETURN or sym == Input.KEY_KP_ENTER then
        ui.pathFocused = false
        if ui.xmlPath ~= "" then
            uiLog("Path set: " .. ui.xmlPath)
        end
        return
    end

    -- Escape → cancel edit
    if sym == Input.KEY_ESCAPE then
        ui.pathFocused = false
        return
    end

    -- Backspace
    if sym == Input.KEY_BACK then
        if #ui.xmlPath > 0 then
            ui.xmlPath = string.sub(ui.xmlPath, 1, #ui.xmlPath - 1)
        end
        return
    end

    -- Delete (clear whole field)
    if sym == Input.KEY_DELETE then
        ui.xmlPath = ""
        return
    end

    -- Printable character  (unicode > 31 means printable in Latin-1)
    if unicode and unicode > 31 then
        ui.xmlPath = ui.xmlPath .. string.char(unicode)
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
--  Initialise  (runs once when the script loads)
-- ─────────────────────────────────────────────────────────────────────────────
overlays.box = newOverlay()
uiLog("FS25 Field Importer ready.")
uiLog("Browse for your stage6_final.xml file to begin.")
