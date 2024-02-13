import {
	flagPath,
	getFlag,
	getSetting,
	registerWrapper,
	render,
	setFlag,
	subLocalize,
} from "module-api";
import { wrapperError } from "../misc";

const ITEM_PREPARE_DERIVED_DATA =
	"CONFIG.Item.documentClass.prototype.prepareDerivedData";
const LOOT_TRANSFER_ITEM_TO_ACTOR =
	"CONFIG.PF2E.Actor.documentClasses.loot.prototype.transferItemToActor";

const RATIO_MAX = 5;
const RATIO_MIN = 0.1;
const RATIO_STEP = 0.1;

export function registerMerchant() {
	return {
		settings: [
			{
				key: "merchant",
				type: Boolean,
				default: false,
				requiresReload: true,
			},
		],
		init: () => {
			if (!getSetting("merchant")) return;
			Hooks.on("renderLootSheetPF2e", renderLootSheetPF2e);
			registerWrapper(
				ITEM_PREPARE_DERIVED_DATA,
				itemPrepareDerivedData,
				"WRAPPER",
			);
			registerWrapper(
				LOOT_TRANSFER_ITEM_TO_ACTOR,
				lootTranferItemToActor,
				"OVERRIDE",
			);
		},
	};
}

async function renderLootSheetPF2e(sheet, html) {
	const actor = sheet.actor;
	if (!actor?.isMerchant) return;

	const {
		noCoins = false,
		priceRatio = 1,
		infiniteStocks = false,
		infiniteItems = {},
	} = getFlag(actor, "merchant") ?? {};

	const localize = subLocalize("merchant");

	const sheetTemplate = await render("merchant/sheet", {
		noCoins,
		infiniteStocks,
		priceRatio: {
			value: clampRatio(priceRatio),
			max: RATIO_MAX,
			min: RATIO_MIN,
			step: RATIO_STEP,
		},
		actorUUID: actor.uuid,
		i18n: localize,
		flagPath: (str) => flagPath("merchant", str),
	});

	html.find(".sheet-sidebar .editor").before(sheetTemplate);

	const itemTypes = html
		.find(".content .sheet-body [data-item-types]")
		.filter("[data-item-types!=treasure]");

	let hasInfiniteStock = infiniteStocks;

	if (infiniteStocks) {
		itemTypes.find(".quantity a").remove();
	} else {
		const items = itemTypes.find("[data-item-id]");
		const tooltip = localize.path("infinite-item.tooltip");

		for (const item of items) {
			const itemId = item.dataset.itemId;
			const isInfinite = !!infiniteItems[itemId];
			const toggle =
				$(`<a data-action="toggle-infinite-item" data-tooltip="${tooltip}">
	<i class="${isInfinite ? "fa-solid" : "fa-duotone"} fa-infinity"></i>
</a>`)[0];

			item.querySelector(".item-controls").prepend(toggle);

			for (const el of item.querySelectorAll(".quantity a")) {
				el.remove();
			}

			toggle.addEventListener("click", (event) => {
				const flagKey = `merchant.infiniteItems.${itemId}`;
				const current = getFlag(actor, flagKey) ?? false;
				setFlag(actor, flagKey, !current);
			});

			if (isInfinite) {
				hasInfiniteStock = true;
			}
		}
	}

	if (hasInfiniteStock) {
		html.find(".content .sheet-body .coinage .wealth h3:last span").html("-");

		html.find(".content .sheet-body .total-bulk span").html(
			game.i18n.format("PF2E.Actor.Inventory.TotalBulk", {
				bulk: "-",
			}),
		);
	}
}

function itemPrepareDerivedData(wrapped) {
	wrapped();

	try {
		if (!this.isOfType("physical") || this.isOfType("treasure")) return;

		const actor = this.actor;
		if (!actor?.isMerchant) return;

		const actorFlags = getFlag(actor, "merchant");
		if (!actorFlags) return;

		const { priceRatio, infiniteStocks, infiniteItems = {} } = actorFlags;

		if (typeof priceRatio === "number" && priceRatio !== 1) {
			const ratio = clampRatio(priceRatio);
			this.system.price.value = this.system.price.value.scale(ratio);
		}

		const isInfinite = (() => {
			if (typeof infiniteStocks === "boolean" && infiniteStocks) {
				return true;
			}
			const infiniteItem = infiniteItems[this.id];
			return typeof infiniteItem === "boolean" && infiniteItem;
		})();

		if (isInfinite) {
			this.system.quantity = 9999;
		}
	} catch (error) {
		wrapperError("merchant", ITEM_PREPARE_DERIVED_DATA);
	}
}

async function lootTranferItemToActor(
	targetActor,
	item,
	quantity,
	containerId,
	newStack = false,
) {
	const thisSuper = Actor.implementation.prototype;

	if (!(this.isOwner && targetActor.isOwner)) {
		return thisSuper.transferItemToActor(
			targetActor,
			item,
			quantity,
			containerId,
			newStack,
		);
	}
	if (this.isMerchant && item.isOfType("physical")) {
		const itemValue = game.pf2e.Coins.fromPrice(item.price, quantity);
		if (await targetActor.inventory.removeCoins(itemValue)) {
			if (!getFlag(this, "merchant.noCoins")) {
				await item.actor.inventory.addCoins(itemValue);
			}
			return thisSuper.transferItemToActor(
				targetActor,
				item,
				quantity,
				containerId,
				newStack,
			);
		}
		if (this.isLoot) {
			throw ErrorPF2e("Loot transfer failed");
		}
		return null;
	}

	return thisSuper.transferItemToActor(
		targetActor,
		item,
		quantity,
		containerId,
		newStack,
	);
}

function clampRatio(value) {
	return Math.clamped(value, RATIO_MIN, RATIO_MAX);
}
