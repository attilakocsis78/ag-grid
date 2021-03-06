import {Utils as _} from '../utils';
import {RenderedCell} from "./renderedCell";
import {RowNode} from "../entities/rowNode";
import {GridOptionsWrapper} from "../gridOptionsWrapper";
import {Grid} from "../grid";
import {ColumnController} from "../columnController/columnController";
import {ExpressionService} from "../expressionService";
import {RowRenderer} from "./rowRenderer";
import {SelectionRendererFactory} from "../selectionRendererFactory";
import {TemplateService} from "../templateService";
import {ValueService} from "../valueService";
import {Column} from "../entities/column";
import {Events} from "../events";
import {GridCore} from "../gridCore";
import {EventService} from "../eventService";
import {Qualifier} from "../context/context";
import {Context} from "../context/context";
import {Autowired} from "../context/context";
import {ColumnChangeEvent} from "../columnChangeEvent";
import {PostConstruct} from "../context/context";
import {FocusedCellController} from "../focusedCellController";
import {Constants} from "../constants";
import {GridCell} from "../entities/gridCell";

export class RenderedRow {

    public static EVENT_RENDERED_ROW_REMOVED = 'renderedRowRemoved';

    @Autowired('gridOptionsWrapper') private gridOptionsWrapper: GridOptionsWrapper;
    @Autowired('columnController') private columnController: ColumnController;
    @Autowired('$compile') private $compile: any;
    @Autowired('eventService') private mainEventService: EventService;
    @Autowired('context') private context: Context;
    @Autowired('focusedCellController') private focusedCellController: FocusedCellController;

    public ePinnedLeftRow: HTMLElement;
    public ePinnedRightRow: HTMLElement;
    public eBodyRow: HTMLElement;
    private eLeftCenterAndRightRows: HTMLElement[];

    private renderedCells: {[key: string]: RenderedCell} = {};
    private scope: any;
    private rowNode: RowNode;
    private rowIndex: number;

    private rowIsHeaderThatSpans: boolean;

    private cellRendererMap: {[key: string]: any};

    private parentScope: any;
    private rowRenderer: RowRenderer;
    private pinningLeft: boolean;
    private pinningRight: boolean;
    private eBodyContainer: HTMLElement;
    private ePinnedLeftContainer: HTMLElement;
    private ePinnedRightContainer: HTMLElement;

    private destroyFunctions: Function[] = [];

    private renderedRowEventService: EventService;

    constructor(parentScope: any,
                cellRendererMap: {[key: string]: any},
                rowRenderer: RowRenderer,
                eBodyContainer: HTMLElement,
                ePinnedLeftContainer: HTMLElement,
                ePinnedRightContainer: HTMLElement,
                node: RowNode,
                rowIndex: number) {
        this.parentScope = parentScope;
        this.cellRendererMap = cellRendererMap;
        this.rowRenderer = rowRenderer;
        this.eBodyContainer = eBodyContainer;
        this.ePinnedLeftContainer = ePinnedLeftContainer;
        this.ePinnedRightContainer = ePinnedRightContainer;

        this.rowIndex = rowIndex;
        this.rowNode = node;
    }

    @PostConstruct
    public init(): void {
        this.pinningLeft = this.columnController.isPinningLeft();
        this.pinningRight = this.columnController.isPinningRight();

        this.createContainers();

        var groupHeaderTakesEntireRow = this.gridOptionsWrapper.isGroupUseEntireRow();
        this.rowIsHeaderThatSpans = this.rowNode.group && groupHeaderTakesEntireRow;

        this.scope = this.createChildScopeOrNull(this.rowNode.data);

        if (this.rowIsHeaderThatSpans) {
            this.createGroupRow();
        } else {
            this.refreshCellsIntoRow();
        }

        this.addDynamicStyles();
        this.addDynamicClasses();

        this.addRowIds();
        this.setTopAndHeightCss();

        if (this.scope) {
            this.eLeftCenterAndRightRows.forEach( row => this.$compile(row)(this.scope));
        }

        this.addRowSelectedListener();
        this.addCellFocusedListener();
        this.addColumnListener();

        this.attachContainers();

        this.gridOptionsWrapper.executeProcessRowPostCreateFunc({
            eRow: this.eBodyRow,
            ePinnedLeftRow: this.ePinnedLeftRow,
            ePinnedRightRow: this.ePinnedRightRow,
            node: this.rowNode,
            api: this.gridOptionsWrapper.getApi(),
            rowIndex: this.rowIndex,
            addRenderedRowListener: this.addEventListener.bind(this),
            columnApi: this.gridOptionsWrapper.getColumnApi(),
            context: this.gridOptionsWrapper.getContext()
        });
    }

    private addColumnListener(): void {
        var columnListener = this.onColumnChanged.bind(this);

        this.mainEventService.addEventListener(Events.EVENT_COLUMN_GROUP_OPENED, columnListener);
        //this.mainEventService.addEventListener(Events.EVENT_COLUMN_MOVED, columnListener);
        //this.mainEventService.addEventListener(Events.EVENT_COLUMN_ROW_GROUP_CHANGE, columnListener);
        //this.mainEventService.addEventListener(Events.EVENT_COLUMN_RESIZED, columnListener);
        //this.mainEventService.addEventListener(Events.EVENT_COLUMN_VALUE_CHANGE, columnListener);
        this.mainEventService.addEventListener(Events.EVENT_COLUMN_VISIBLE, columnListener);
        this.mainEventService.addEventListener(Events.EVENT_COLUMN_PINNED, columnListener);

        this.destroyFunctions.push( () => {
            this.mainEventService.removeEventListener(Events.EVENT_COLUMN_GROUP_OPENED, columnListener);
            //this.mainEventService.removeEventListener(Events.EVENT_COLUMN_MOVED, columnListener);
            //this.mainEventService.removeEventListener(Events.EVENT_COLUMN_ROW_GROUP_CHANGE, columnListener);
            //this.mainEventService.removeEventListener(Events.EVENT_COLUMN_RESIZED, columnListener);
            //this.mainEventService.removeEventListener(Events.EVENT_COLUMN_VALUE_CHANGE, columnListener);
            this.mainEventService.removeEventListener(Events.EVENT_COLUMN_VISIBLE, columnListener);
            this.mainEventService.removeEventListener(Events.EVENT_COLUMN_PINNED, columnListener);
        });
    }

    private onColumnChanged(event: ColumnChangeEvent): void {
        // if row is a group row that spans, then it's not impacted by column changes
        if (this.rowIsHeaderThatSpans) {
            return;
        }
        this.refreshCellsIntoRow();
    }

    private refreshCellsIntoRow() {

        var columns = this.columnController.getAllDisplayedColumns();

        var renderedCellKeys = Object.keys(this.renderedCells);

        columns.forEach( (column: Column) => {
            var renderedCell = this.getOrCreateCell(column);
            this.ensureCellInCorrectRow(renderedCell);
            renderedCell.checkPinnedClasses();
            _.removeFromArray(renderedCellKeys, column.getColId());
        });

        // remove old cells from gui, but we don't destroy them, we might use them again
        renderedCellKeys.forEach( (key: string)=> {
            var renderedCell = this.renderedCells[key];
            // could be old reference, ie removed cell
            if (!renderedCell) {
                return;
            }
            if (renderedCell.getParentRow()) {
                renderedCell.getParentRow().removeChild(renderedCell.getGui());
                renderedCell.setParentRow(null);
            }
            renderedCell.destroy();
            this.renderedCells[key] = null;
        });
    }

    private ensureCellInCorrectRow(renderedCell: RenderedCell): void {
        var eRowGui = renderedCell.getGui();
        var column = renderedCell.getColumn();

        var rowWeWant: HTMLElement;
        switch (column.getPinned()) {
            case Column.PINNED_LEFT: rowWeWant = this.ePinnedLeftRow; break;
            case Column.PINNED_RIGHT: rowWeWant = this.ePinnedRightRow; break;
            default: rowWeWant = this.eBodyRow; break;
        }

        // if in wrong container, remove it
        var oldRow = renderedCell.getParentRow();
        var inWrongRow = oldRow !== rowWeWant;
        if (inWrongRow) {
            // take out from old row
            if (oldRow) {
                oldRow.removeChild(eRowGui);
            }

            rowWeWant.appendChild(eRowGui);
            renderedCell.setParentRow(rowWeWant);
        }
    }

    private getOrCreateCell(column: Column): RenderedCell {

        var colId = column.getColId();
        if (this.renderedCells[colId]) {
            return this.renderedCells[colId];
        } else {
            var renderedCell = new RenderedCell(column,
                this.cellRendererMap, this.rowNode,
                this.rowIndex, this.scope, this);
            this.context.wireBean(renderedCell);
            this.renderedCells[colId] = renderedCell;
            return renderedCell;
        }
    }

    private addRowSelectedListener(): void {
        var rowSelectedListener = () => {
            var selected = this.rowNode.isSelected();
            this.eLeftCenterAndRightRows.forEach( (row) => _.addOrRemoveCssClass(row, 'ag-row-selected', selected) );
        };
        this.rowNode.addEventListener(RowNode.EVENT_ROW_SELECTED, rowSelectedListener);
        this.destroyFunctions.push(()=> {
            this.rowNode.removeEventListener(RowNode.EVENT_ROW_SELECTED, rowSelectedListener);
        });
    }

    private addCellFocusedListener(): void {
        var rowFocusedLastTime: boolean = null;
        var rowFocusedListener = () => {
            var rowFocused = this.focusedCellController.isRowFocused(this.rowIndex, this.rowNode.floating);
            if (rowFocused !== rowFocusedLastTime) {
                this.eLeftCenterAndRightRows.forEach( (row) => _.addOrRemoveCssClass(row, 'ag-row-focus', rowFocused) );
                this.eLeftCenterAndRightRows.forEach( (row) => _.addOrRemoveCssClass(row, 'ag-row-no-focus', !rowFocused) );
                rowFocusedLastTime = rowFocused;
            }
        };
        this.mainEventService.addEventListener(Events.EVENT_CELL_FOCUSED, rowFocusedListener);
        this.destroyFunctions.push(()=> {
            this.mainEventService.removeEventListener(Events.EVENT_CELL_FOCUSED, rowFocusedListener);
        });
        rowFocusedListener();
    }

    private createContainers(): void {
        this.eBodyRow = this.createRowContainer();
        this.eLeftCenterAndRightRows = [this.eBodyRow];

        if (!this.gridOptionsWrapper.isForPrint()) {
            this.ePinnedLeftRow = this.createRowContainer();
            this.ePinnedRightRow = this.createRowContainer();

            this.eLeftCenterAndRightRows.push(this.ePinnedLeftRow);
            this.eLeftCenterAndRightRows.push(this.ePinnedRightRow);
        }
    }

    private attachContainers(): void {
        this.eBodyContainer.appendChild(this.eBodyRow);

        if (!this.gridOptionsWrapper.isForPrint()) {
            this.ePinnedLeftContainer.appendChild(this.ePinnedLeftRow);
            this.ePinnedRightContainer.appendChild(this.ePinnedRightRow);
        }
    }

    public onMouseEvent(eventName: string, mouseEvent: MouseEvent, eventSource: HTMLElement, cell: GridCell): void {
        var renderedCell = this.renderedCells[cell.column.getId()];
        if (renderedCell) {
            renderedCell.onMouseEvent(eventName, mouseEvent, eventSource);
        }
    }

    private setTopAndHeightCss(): void {
        // if showing scrolls, position on the container
        if (!this.gridOptionsWrapper.isForPrint()) {
            var topPx = this.rowNode.rowTop + "px";
            this.eLeftCenterAndRightRows.forEach( row => row.style.top = topPx);
        }
        var heightPx = this.rowNode.rowHeight + 'px';
        this.eLeftCenterAndRightRows.forEach( row => row.style.height = heightPx);
    }

    // adds in row and row-id attributes to the row
    private addRowIds(): void {
        var rowStr = this.rowIndex.toString();
        if (this.rowNode.floating===Constants.FLOATING_BOTTOM) {
            rowStr = 'fb-' + rowStr;
        } else if (this.rowNode.floating===Constants.FLOATING_TOP) {
            rowStr = 'ft-' + rowStr;
        }
        this.eLeftCenterAndRightRows.forEach( row => row.setAttribute('row', rowStr) );

        if (typeof this.gridOptionsWrapper.getBusinessKeyForNodeFunc() === 'function') {
            var businessKey = this.gridOptionsWrapper.getBusinessKeyForNodeFunc()(this.rowNode);
            if (typeof businessKey === 'string' || typeof businessKey === 'number') {
                this.eLeftCenterAndRightRows.forEach( row => row.setAttribute('row-id', businessKey) );
            }
        }
    }

    public addEventListener(eventType: string, listener: Function): void {
        if (!this.renderedRowEventService) { this.renderedRowEventService = new EventService(); }
        this.renderedRowEventService.addEventListener(eventType, listener);
    }

    public removeEventListener(eventType: string, listener: Function): void {
        this.renderedRowEventService.removeEventListener(eventType, listener);
    }

    public softRefresh(): void {
        _.iterateObject(this.renderedCells, (key: any, renderedCell: RenderedCell)=> {
            if (renderedCell && renderedCell.isVolatile()) {
                renderedCell.refreshCell();
            }
        });
    }

    public getRenderedCellForColumn(column: Column): RenderedCell {
        return this.renderedCells[column.getColId()];
    }

    public getCellForCol(column: Column): HTMLElement {
        var renderedCell = this.renderedCells[column.getColId()];
        if (renderedCell) {
            return renderedCell.getGui();
        } else {
            return null;
        }
    }

    public destroy(): void {

        this.destroyFunctions.forEach( func => func() );

        this.destroyScope();

        this.eBodyContainer.removeChild(this.eBodyRow);
        if (!this.gridOptionsWrapper.isForPrint()) {
            this.ePinnedLeftContainer.removeChild(this.ePinnedLeftRow);
            this.ePinnedRightContainer.removeChild(this.ePinnedRightRow);
        }

        _.iterateObject(this.renderedCells, (key: any, renderedCell: RenderedCell)=> {
            if (renderedCell) {
                renderedCell.destroy();
            }
        });

        if (this.renderedRowEventService) {
            this.renderedRowEventService.dispatchEvent(RenderedRow.EVENT_RENDERED_ROW_REMOVED, {node: this.rowNode});
        }
    }

    private destroyScope(): void {
        if (this.scope) {
            this.scope.$destroy();
            this.scope = null;
        }
    }

    public isDataInList(rows: any[]): boolean {
        return rows.indexOf(this.rowNode.data) >= 0;
    }

    public isGroup(): boolean {
        return this.rowNode.group === true;
    }

    private createGroupRow() {
        var eGroupRow = this.createGroupSpanningEntireRowCell(false);

        if (this.pinningLeft) {
            this.ePinnedLeftRow.appendChild(eGroupRow);
            var eGroupRowPadding = this.createGroupSpanningEntireRowCell(true);
            this.eBodyRow.appendChild(eGroupRowPadding);
        } else {
            this.eBodyRow.appendChild(eGroupRow);
        }

        if (this.pinningRight) {
            var ePinnedRightPadding = this.createGroupSpanningEntireRowCell(true);
            this.ePinnedRightRow.appendChild(ePinnedRightPadding);
        }
    }

    private createGroupSpanningEntireRowCell(padding: any) {
        var eRow: any;
        // padding means we are on the right hand side of a pinned table, ie
        // in the main body.
        if (padding) {
            eRow = document.createElement('span');
        } else {
            var rowCellRenderer = this.gridOptionsWrapper.getGroupRowRenderer();
            if (!rowCellRenderer) {
                rowCellRenderer = {
                    renderer: 'group',
                    innerRenderer: this.gridOptionsWrapper.getGroupRowInnerRenderer()
                };
            }
            var params = {
                node: this.rowNode,
                data: this.rowNode.data,
                rowIndex: this.rowIndex,
                api: this.gridOptionsWrapper.getApi(),
                colDef: {
                    cellRenderer: rowCellRenderer
                }
            };

            // start duplicated code
            var actualCellRenderer: Function;
            if (typeof rowCellRenderer === 'object' && rowCellRenderer !== null) {
                var cellRendererObj = <{ renderer: string }> rowCellRenderer;
                actualCellRenderer = this.cellRendererMap[cellRendererObj.renderer];
                if (!actualCellRenderer) {
                    throw 'Cell renderer ' + rowCellRenderer + ' not found, available are ' + Object.keys(this.cellRendererMap);
                }
            } else if (typeof rowCellRenderer === 'function') {
                actualCellRenderer = <Function>rowCellRenderer;
            } else {
                throw 'Cell Renderer must be String or Function';
            }
            var resultFromRenderer = actualCellRenderer(params);
            // end duplicated code

            if (_.isNodeOrElement(resultFromRenderer)) {
                // a dom node or element was returned, so add child
                eRow = resultFromRenderer;
            } else {
                // otherwise assume it was html, so just insert
                eRow = _.loadTemplate(resultFromRenderer);
            }
        }
        if (this.rowNode.footer) {
            _.addCssClass(eRow, 'ag-footer-cell-entire-row');
        } else {
            _.addCssClass(eRow, 'ag-group-cell-entire-row');
        }

        return eRow;
    }

    private createChildScopeOrNull(data: any) {
        if (this.gridOptionsWrapper.isAngularCompileRows()) {
            var newChildScope = this.parentScope.$new();
            newChildScope.data = data;
            return newChildScope;
        } else {
            return null;
        }
    }

    private addDynamicStyles() {
        var rowStyle = this.gridOptionsWrapper.getRowStyle();
        if (rowStyle) {
            if (typeof rowStyle === 'function') {
                console.log('ag-Grid: rowStyle should be an object of key/value styles, not be a function, use getRowStyle() instead');
            } else {
                this.eLeftCenterAndRightRows.forEach( row => _.addStylesToElement(row, rowStyle));
            }
        }
        var rowStyleFunc = this.gridOptionsWrapper.getRowStyleFunc();
        if (rowStyleFunc) {
            var params = {
                data: this.rowNode.data,
                node: this.rowNode,
                api: this.gridOptionsWrapper.getApi(),
                context: this.gridOptionsWrapper.getContext(),
                $scope: this.scope
            };
            var cssToUseFromFunc = rowStyleFunc(params);
            this.eLeftCenterAndRightRows.forEach( row => _.addStylesToElement(row, cssToUseFromFunc));
        }
    }

    private createParams(): any {
        var params = {
            node: this.rowNode,
            data: this.rowNode.data,
            rowIndex: this.rowIndex,
            $scope: this.scope,
            context: this.gridOptionsWrapper.getContext(),
            api: this.gridOptionsWrapper.getApi()
        };
        return params;
    }

    private createEvent(event: any, eventSource: any): any {
        var agEvent = this.createParams();
        agEvent.event = event;
        agEvent.eventSource = eventSource;
        return agEvent;
    }

    private createRowContainer(): HTMLElement {
        var vRow = document.createElement('div');
        vRow.addEventListener("click", this.onRowClicked.bind(this));
        vRow.addEventListener("dblclick", (event: any) => {
            var agEvent = this.createEvent(event, this);
            this.mainEventService.dispatchEvent(Events.EVENT_ROW_DOUBLE_CLICKED, agEvent);
        });

        return vRow;
    }

    public onRowClicked(event: MouseEvent) {

        var agEvent = this.createEvent(event, this);
        this.mainEventService.dispatchEvent(Events.EVENT_ROW_CLICKED, agEvent);

        // ctrlKey for windows, metaKey for Apple
        var multiSelectKeyPressed = event.ctrlKey || event.metaKey;

        // we do not allow selecting groups by clicking (as the click here expands the group)
        // so return if it's a group row
        if (this.rowNode.group) {
            return;
        }

        // we also don't allow selection of floating rows
        if (this.rowNode.floating) {
            return;
        }

        // making local variables to make the below more readable
        var gridOptionsWrapper = this.gridOptionsWrapper;

        // if no selection method enabled, do nothing
        if (!gridOptionsWrapper.isRowSelection()) {
            return;
        }

        // if click selection suppressed, do nothing
        if (gridOptionsWrapper.isSuppressRowClickSelection()) {
            return;
        }

        if (this.rowNode.isSelected()) {
            if (multiSelectKeyPressed) {
                if (gridOptionsWrapper.isRowDeselection()) {
                    this.rowNode.setSelected(false);
                }
            } else {
                // selected with no multi key, must make sure anything else is unselected
                this.rowNode.setSelected(true, true);
            }
        } else {
            this.rowNode.setSelected(true, !multiSelectKeyPressed);
        }
    }

    public getRowNode(): any {
        return this.rowNode;
    }

    public getRowIndex(): any {
        return this.rowIndex;
    }

    public refreshCells(colIds: string[]): void {
        if (!colIds) {
            return;
        }
        var columnsToRefresh = this.columnController.getColumns(colIds);

        _.iterateObject(this.renderedCells, (key: any, renderedCell: RenderedCell)=> {
            if (!renderedCell) {
                return;
            }
            var colForCel = renderedCell.getColumn();
            if (columnsToRefresh.indexOf(colForCel)>=0) {
                renderedCell.refreshCell();
            }
        });
    }

    private addDynamicClasses() {
        var classes: string[] = [];

        classes.push('ag-row');
        classes.push('ag-row-no-focus');

        classes.push(this.rowIndex % 2 == 0 ? "ag-row-even" : "ag-row-odd");

        if (this.rowNode.isSelected()) {
            classes.push("ag-row-selected");
        }

        if (this.rowNode.group) {
            classes.push("ag-row-group");
            // if a group, put the level of the group in
            classes.push("ag-row-level-" + this.rowNode.level);

            if (!this.rowNode.footer && this.rowNode.expanded) {
                classes.push("ag-row-group-expanded");
            }
            if (!this.rowNode.footer && !this.rowNode.expanded) {
                // opposite of expanded is contracted according to the internet.
                classes.push("ag-row-group-contracted");
            }
            if (this.rowNode.footer) {
                classes.push("ag-row-footer");
            }
        } else {
            // if a leaf, and a parent exists, put a level of the parent, else put level of 0 for top level item
            if (this.rowNode.parent) {
                classes.push("ag-row-level-" + (this.rowNode.parent.level + 1));
            } else {
                classes.push("ag-row-level-0");
            }
        }

        // add in extra classes provided by the config
        var gridOptionsRowClass = this.gridOptionsWrapper.getRowClass();
        if (gridOptionsRowClass) {
            if (typeof gridOptionsRowClass === 'function') {
                console.warn('ag-Grid: rowClass should not be a function, please use getRowClass instead');
            } else {
                if (typeof gridOptionsRowClass === 'string') {
                    classes.push(gridOptionsRowClass);
                } else if (Array.isArray(gridOptionsRowClass)) {
                    gridOptionsRowClass.forEach(function (classItem: any) {
                        classes.push(classItem);
                    });
                }
            }
        }

        var gridOptionsRowClassFunc = this.gridOptionsWrapper.getRowClassFunc();
        if (gridOptionsRowClassFunc) {
            var params = {
                node: this.rowNode,
                data: this.rowNode.data,
                rowIndex: this.rowIndex,
                context: this.gridOptionsWrapper.getContext(),
                api: this.gridOptionsWrapper.getApi()
            };
            var classToUseFromFunc = gridOptionsRowClassFunc(params);
            if (classToUseFromFunc) {
                if (typeof classToUseFromFunc === 'string') {
                    classes.push(classToUseFromFunc);
                } else if (Array.isArray(classToUseFromFunc)) {
                    classToUseFromFunc.forEach(function (classItem: any) {
                        classes.push(classItem);
                    });
                }
            }
        }

        classes.forEach( (classStr: string) => {
            this.eLeftCenterAndRightRows.forEach( row => _.addCssClass(row, classStr));
        });
    }
}
