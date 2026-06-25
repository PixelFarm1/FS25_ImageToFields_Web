-- Author:PixelFarm
-- Name:coordinatesToFields
-- Namespace: local
-- Description:
-- Icon:
-- Hide: no
-- AlwaysLoaded: no
-- Giants Editor Lua Script
-- Load XML and dynamically create fields based on XML data
-- Function to load and parse the XML file
source("map/farmlandFields/fieldUtil.lua")
source("map/farmlandFields/fieldToolkit.lua")
function loadAndCreateFields(filepath)
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
        -- Root node for fields
        local fieldNode = FieldUtil.getFieldsRootNode()
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
        -- Add a note to the nameIndicator
        local note = createNoteNode(nameIndicator, name, 0, 0, 0, true)
        link(nameIndicator, note)
        setTranslation(note, 0, 0, 0)
        -- Link components to the field
        link(field, polygonPoints)
        link(field, nameIndicator)
        link(field, teleportIndicator)
        -- Link the field to the fields root node
        link(fieldNode, field)
        -- Set user attributes
        setUserAttribute(field, "polygonIndex", UserAttributeType.STRING, EditorUtils.getNodeIndexPath(field, polygonPoints))
        setUserAttribute(field, "nameIndicatorIndex", UserAttributeType.STRING, EditorUtils.getNodeIndexPath(field, nameIndicator))
        setUserAttribute(field, "teleportIndicatorIndex", UserAttributeType.STRING, EditorUtils.getNodeIndexPath(field, teleportIndicator))
        setUserAttribute(field, "angle", UserAttributeType.INTEGER, 0)
        setUserAttribute(field, "missionOnlyGrass", UserAttributeType.BOOLEAN, false)
        setUserAttribute(field, "missionAllowed", UserAttributeType.BOOLEAN, true)
        -- Set the translation of the field based on X and Y from the XML
        setTranslation(field, x, 0, y)
        -- Update the field note and select the new field
        FieldToolkit.updateFieldNote(field)
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
local filepath = "PATH/final_field_coordinates.xml" -- Replace with your XML file path
loadAndCreateFields(filepath)
FieldToolkit:clearFieldGround()
FieldToolkit:alignPolygonPointsToTerrain()
FieldToolkit:adjustFieldPivots()
FieldToolkit:repaintFields()
