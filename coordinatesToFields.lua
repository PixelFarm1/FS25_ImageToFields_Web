-- Author:PixelFarm
-- Name:coordinatesToFields
-- Namespace: local
-- Description:
-- Icon:
-- Hide: no
-- AlwaysLoaded: no


local function getFieldToolkit()
    local function fromGlobal()
        if g_mapToolkit ~= nil and g_mapToolkit.getPluginByName ~= nil then
            return g_mapToolkit:getPluginByName("MapToolkitField")
        end
        return nil
    end

    -- Reuse the toolkit when it is already open.
    local plugin = fromGlobal()
    if plugin ~= nil then
        return plugin
    end

    -- Plain Lua checks only: the game script helpers do not exist yet at this point.
    local sceneFilename = getSceneFilename()
    if sceneFilename == nil or sceneFilename == "" then
        printError("No map loaded. Open your map i3d before running this script.")
        return nil
    end

    if g_terrainNode == nil then
        printError("No terrain found in the loaded scene.")
        return nil
    end

    -- Loads the game scripts, opens the MapToolkit window and fills g_mapToolkit with plugins.
    source("map/MapToolkitUI.lua")

    plugin = fromGlobal()
    if plugin == nil then
        printError("Could not obtain the MapToolkitField plugin. If MapToolkit itself fails with "
            .. "\"MapToolkit.lua:191: attempt to call a nil value\", a previous script left a broken "
            .. "plugin table behind: restart the GIANTS Editor and run this script again.")
    end

    return plugin
end

--- Asks the user to pick the field coordinates XML.
-- @return string? filepath nil when the dialog was cancelled
local function selectFieldXMLFile()
    -- Start in the folder of the loaded map, so the dialog opens somewhere useful.
    local startPath = g_coordinatesToFieldsLastFile

    if startPath == nil or startPath == "" then
        local sceneFilename = getSceneFilename()
        startPath = sceneFilename ~= nil and string.match(sceneFilename, "^(.*[/\\])") or ""
    end

    local filepath = openFileDialog(startPath, "Field Coordinates XML|*.xml")
    if filepath == nil or filepath == "" then
        print("No file selected, aborting.")
        return nil
    end

    -- Remembered as the dialog's start path if the editor keeps globals between runs.
    g_coordinatesToFieldsLastFile = filepath

    return filepath
end

-- Function to load and parse the XML file
function loadAndCreateFields(filepath, fieldTool)
    if filepath == nil or filepath == "" then
        print("Filepath is empty. Please specify a valid XML file path.")
        return
    end

    -- Load the XML file
    local xmlFile = loadXMLFile("FieldData", filepath)
    if xmlFile == 0 then
        print("Failed to load XML file from path: " .. filepath)
        return
    end

    print("Successfully loaded XML file: " .. filepath)

    local function createFieldFromXML(fieldID, x, y, coordinates)
        -- Root node for fields (moved from FieldUtil to MapToolkitField, still a static function)
        local fieldNode = fieldTool.getFieldsRootNode()
        if fieldNode == nil then
            printError("No fields node defined")
            return nil
        end

        -- Set field name to "field" followed by the ID from the XML
        local name = string.format("field%d", fieldID)
        local field = createTransformGroup(name)

        -- Create the polygonPoints group
        local polygonPoints = createTransformGroup("polygonPoints")
        for i, coord in ipairs(coordinates) do
            local point = createTransformGroup(string.format("point%d", i))
            setTranslation(point, coord.x, 0, coord.y)
            link(polygonPoints, point)
        end

        -- Create the nameIndicator and teleportIndicator
        local nameIndicator = createTransformGroup("nameIndicator")
        local teleportIndicator = createTransformGroup("teleportIndicator")

        -- Add a note to the nameIndicator (createNoteNode already links it to its parent)
        local note = createNoteNode(nameIndicator, name, 0, 0, 0, true)
        setTranslation(note, 0, 0, 0)

        -- Link components to the field
        link(field, polygonPoints)
        link(field, nameIndicator)
        link(field, teleportIndicator)

        -- Link the field to the fields root node
        link(fieldNode, field)

        -- Set user attributes
        setUserAttribute(field, "polygonIndex", UserAttributeType.STRING, I3DUtil.getNodePathIndices(polygonPoints, field, false))
        setUserAttribute(field, "nameIndicatorIndex", UserAttributeType.STRING, I3DUtil.getNodePathIndices(nameIndicator, field, false))
        setUserAttribute(field, "teleportIndicatorIndex", UserAttributeType.STRING, I3DUtil.getNodePathIndices(teleportIndicator, field, false))
        setUserAttribute(field, "angle", UserAttributeType.INTEGER, 0)
        setUserAttribute(field, "missionOnlyGrass", UserAttributeType.BOOLEAN, false)
        setUserAttribute(field, "missionAllowed", UserAttributeType.BOOLEAN, true)

        -- Set the translation of the field based on X and Y from the XML
        setTranslation(field, x, 0, y)

        -- Update the field note and select the new field
        fieldTool:updateFieldNote(field)
        addSelection(field)

        print(string.format("Created new field '%s' at X: %d, Y: %d", name, x, y))
        return field
    end

    -- Read fields from the XML
    local i = 0
    while true do
        local fieldKey = string.format("Fields.Field(%d)", i)
        if not hasXMLProperty(xmlFile, fieldKey) then
            break
        end

        -- Extract <Field> attributes
        local fieldID = getXMLInt(xmlFile, fieldKey .. "#ID")
        local fieldX = getXMLInt(xmlFile, fieldKey .. "#X")
        local fieldY = getXMLInt(xmlFile, fieldKey .. "#Y")

        -- Extract coordinates for this field
        local coordinates = {}
        local j = 0
        while true do
            local coordKey = string.format("%s.coordinate(%d)", fieldKey, j)
            if not hasXMLProperty(xmlFile, coordKey) then
                break
            end

            local coordX = getXMLFloat(xmlFile, coordKey .. "#X")
            local coordY = getXMLFloat(xmlFile, coordKey .. "#Y")
            table.insert(coordinates, {x = coordX, y = coordY})
            j = j + 1
        end

        -- Create a new field using the XML data
        createFieldFromXML(fieldID, fieldX, fieldY, coordinates)
        i = i + 1
    end

    -- Close the XML file
    delete(xmlFile)
    print("Finished processing and creating fields from XML.")
end

local filepath = selectFieldXMLFile()
if filepath == nil then
    return
end

local fieldTool = getFieldToolkit()
if fieldTool == nil then
    return
end

loadAndCreateFields(filepath, fieldTool)

-- Bulk post-processing. "true" disables the per-step progress dialogs.
fieldTool:clearFieldsGround(true)
fieldTool:alignPolygonPointsToTerrain(true)
fieldTool:adjustFieldPivots()
fieldTool:repaintFields(true)

refreshViewport(true)
